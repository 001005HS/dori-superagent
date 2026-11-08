import { DeliveryUncertain, omoScreenIdle, type AgentStatus } from "./herdr.ts";
import { failureDetail } from "./duty.ts";
import { Refusal, resolveTarget, send, tellLead, type Deps, type SendResult } from "./harness.ts";
import type { DeliveryAttempt, QueuedMessage } from "./store-types.ts";

// A pane with no running agent (`shell`) is never ready: text typed into a bare shell runs as a command (#66).
const READY_TO_READ: readonly AgentStatus[] = ["idle", "done"];

/**
 * `dori send --to-shell`: the operator's per-message opt-in to type this one message into a pane with no agent.
 * Only the CLI flag reaches here, never relayed content, and queued messages are never typed with it. If an agent
 * is in the pane, or appears before typing, the message takes the queued agent path instead.
 */
export async function sendToShell(d: Deps, target: string, text: string, from: string): Promise<SendResult> {
  const paneId = resolveTarget(d, target);
  if ((await d.herdr.status(paneId)) !== "shell") return send(d, target, text, from);
  if (await d.herdr.typeIntoShell(paneId, text)) return "DELIVERED";
  d.store.enqueue(paneId, { at: d.now(), from, text });
  return "QUEUED";
}

/**
 * Delivers a pane's queued messages as one batch. `held`: only messages held after an ambiguous delivery are left;
 * they wait for a person or the lead (#89). `queued` also when another flush of this pane holds its inbox lock: one
 * flush per pane at a time, across processes (#108). Throws DeliveryUncertain, having recorded the attempt on the
 * queued messages, when the batch may already have reached the pane, and Refusal when the pane is gone.
 */
export async function flushInbox(d: Deps, paneId: string): Promise<"delivered" | "queued" | "no-agent" | "held"> {
  if (d.store.queued(paneId).length === 0) return "delivered";
  const release = d.store.lockInbox(paneId, d.now());
  if (!release) return "queued";
  try {
    return await flushLocked(d, paneId);
  } finally {
    release();
  }
}

async function flushLocked(d: Deps, paneId: string): Promise<"delivered" | "queued" | "no-agent" | "held"> {
  // Re-read under the lock: the flush that held it may have delivered these meanwhile.
  const all = d.store.queued(paneId);
  if (all.length === 0) return "delivered";
  const queued = all.filter((m) => m.attempt?.state !== "ambiguous");
  let status = await d.herdr.status(paneId);
  // Before the held check, so a gone pane with only held messages says so instead of delivery-ambiguous forever (#108).
  if (status === "gone") throw new Refusal(`pane ${paneId} is gone; ${all.length} message(s) kept in its inbox`);
  if (queued.length === 0) return "held";
  if (status === "working" && (await screenShowsIdle(d, paneId))) status = "idle";
  const typed = queued.filter((m) => m.attempt?.state === "typed");
  if (status === "shell") {
    // The agent the text was typed into is gone from the pane: an Enter later would go to another agent's empty input.
    if (typed.length > 0) await holdTyped(d, paneId, typed, "the agent left the pane before its Enter");
    return "no-agent";
  }
  if (!READY_TO_READ.includes(status)) return "queued";
  if (typed.length > 0) {
    // An earlier pass typed these and only the Enter failed: press Enter, never type them again (#89), and only into
    // the agent they were typed into (#108).
    const submitted = await d.herdr.submitTyped(paneId, typed[0]!.attempt);
    if (submitted === "wait") return "no-agent";
    if (submitted === "changed") {
      await holdTyped(d, paneId, typed, "a different agent is in the pane than the one the text was typed into");
      return typed.length === queued.length ? "held" : "queued";
    }
    settleInbox(d, paneId, typed);
    // Messages queued after the typed batch were not delivered by this Enter; they wait for the next pass.
    return typed.length === queued.length ? "delivered" : "queued";
  }
  const body =
    queued.length === 1
      ? queued[0]!.text
      : `${queued.length} messages arrived while you were busy:\n\n` +
        queued.map((m, i) => `(${i + 1}) from ${m.from}:\n${m.text}`).join("\n\n");
  try {
    if (!(await d.herdr.deliver(paneId, body))) return "no-agent";
  } catch (e) {
    if (e instanceof DeliveryUncertain) await recordUncertain(d, paneId, queued, e);
    throw e;
  }
  settleInbox(d, paneId, queued);
  return "delivered";
}

/** Re-reads the inbox and drops the batch (delivered) or marks it with the failed attempt; messages queued meanwhile stay. */
function settleInbox(d: Deps, paneId: string, batch: readonly QueuedMessage[], attempt?: DeliveryAttempt): void {
  const left = [...batch];
  const rest = d.store.queued(paneId).flatMap((m) => {
    const i = left.findIndex((b) => b.at === m.at && b.from === m.from && b.text === m.text);
    if (i < 0) return [m];
    left.splice(i, 1);
    return attempt ? [{ ...m, attempt }] : [];
  });
  d.store.saveInbox(paneId, rest);
}

const NOTICE_FROM = "dori-delivery";

/**
 * Records an uncertain delivery on the queued messages. Typed text only waits for its Enter. An ambiguous batch is
 * held and the lead is told once; held messages are never retried, so the notice is never repeated. A notice that
 * itself fails ambiguously is held without another notice, so this cannot loop.
 */
async function recordUncertain(
  d: Deps,
  paneId: string,
  batch: readonly QueuedMessage[],
  e: DeliveryUncertain,
): Promise<void> {
  const detail = failureDetail(e);
  settleInbox(d, paneId, batch, {
    at: d.now(),
    state: e.typed ? "typed" : "ambiguous",
    detail,
    ...(e.typed ? e.agent : {}),
  });
  if (!e.typed) await noticeHeld(d, paneId, batch, `herdr said: ${detail}`);
}

/** Typed text whose agent left or changed (#108): it may sit in a lost input, so it is held like an ambiguous batch. */
async function holdTyped(d: Deps, paneId: string, typed: readonly QueuedMessage[], why: string): Promise<void> {
  settleInbox(d, paneId, typed, { at: d.now(), state: "ambiguous", detail: why });
  await noticeHeld(d, paneId, typed, why);
}

async function noticeHeld(d: Deps, paneId: string, batch: readonly QueuedMessage[], why: string): Promise<void> {
  if (batch.every((m) => m.from === NOTICE_FROM)) return;
  const which = batch.map((m) => `from ${m.from} queued ${new Date(m.at).toISOString()}`).join(", ");
  const text =
    `[DELIVERY-AMBIGUOUS ${paneId}] ${batch.length} message(s) (${which}) may or may not have reached the pane; ${why}. ` +
    `Held and not resent. Check the pane and see dori inbox list ${paneId}: if it did not arrive, dori inbox resend ${paneId} <index>; if it did, dori inbox ack ${paneId} <index>.`;
  try {
    await tellLead(d, text, NOTICE_FROM);
  } catch (err) {
    process.stderr.write(
      `dori: telling the lead about the ambiguous delivery to ${paneId} failed too (${failureDetail(err)}); the notice is kept in the lead's inbox\n`,
    );
  }
}

// ---------- held entries (#108) ----------

export type InboxEntry = {
  index: number;
  state: "queued" | "typed" | "held";
  from: string;
  at: number;
  preview: string;
};

const PREVIEW_CHARS = 60;

/** A pane's queued messages, 1-based in inbox order. The text is never shown whole: its first 60 characters, JSON-escaped. */
export function inboxList(d: Deps, target: string): { paneId: string; entries: InboxEntry[] } {
  const paneId = resolveTarget(d, target);
  const entries = d.store.queued(paneId).map(
    (m, i): InboxEntry => ({
      index: i + 1,
      state: m.attempt?.state === "ambiguous" ? "held" : m.attempt?.state === "typed" ? "typed" : "queued",
      from: m.from,
      at: m.at,
      preview: JSON.stringify(m.text.slice(0, PREVIEW_CHARS)) + (m.text.length > PREVIEW_CHARS ? "..." : ""),
    }),
  );
  return { paneId, entries };
}

/**
 * `ack` drops a held entry (it did arrive); `resend` clears its attempt so the next flush delivers it (it did not).
 * Only held entries: a typed one is in the pane's input already, and a queued one is delivered anyway. Runs under the
 * inbox lock, so a flush in progress cannot overwrite the change.
 */
export function releaseHeld(d: Deps, target: string, index: number, how: "ack" | "resend"): string {
  const paneId = resolveTarget(d, target);
  const release = d.store.lockInbox(paneId, d.now());
  if (!release) throw new Refusal(`the inbox of ${paneId} is being flushed right now; try again`);
  try {
    const msgs = d.store.queued(paneId);
    const m = Number.isInteger(index) ? msgs[index - 1] : undefined;
    if (!m)
      throw new Refusal(
        `no entry ${index} in the inbox of ${paneId} (${msgs.length} entries; see dori inbox list ${target})`,
      );
    if (m.attempt?.state !== "ambiguous")
      throw new Refusal(`entry ${index} of ${paneId} is not held; only held entries can be acked or resent`);
    const { attempt: _, ...fresh } = m;
    d.store.saveInbox(
      paneId,
      how === "ack" ? msgs.filter((_, i) => i !== index - 1) : msgs.map((x, i) => (i === index - 1 ? fresh : x)),
    );
    return paneId;
  } finally {
    release();
  }
}

/**
 * herdr reports an omo with live monitors as `working` between turns (#62). Believe the screen only when it
 * positively shows the idle input; a failed read is doubt, so the message stays queued for the next duty pass.
 */
async function screenShowsIdle(d: Deps, paneId: string): Promise<boolean> {
  try {
    return omoScreenIdle(await d.herdr.read(paneId, 30));
  } catch {
    return false;
  }
}
