import { DeliveryUncertain } from "./delivery.ts";
import { failureDetail } from "./duty.ts";
import { Refusal, resolveTarget, send, tellLead, type Deps, type SendResult } from "./harness.ts";
import { refText } from "./refs.ts";
import type { AgentStatus, SessionRef } from "./runtime/types.ts";
import { migrating } from "./store-journal.ts";
import type { DeliveryAttempt, QueuedMessage } from "./store-types.ts";

// A session with no running agent (`shell`) is never ready: text typed into a bare shell runs as a command (#66).
// `error` waits like `blocked`: the agent needs a person before it reads anything.
const READY_TO_READ: readonly AgentStatus[] = ["idle", "done"];

/**
 * `dori send --to-shell`: the operator's per-message opt-in to type this one message into a pane with no agent.
 * Only the CLI flag reaches here, never relayed content, and queued messages are never typed with it. If an agent
 * is in the pane, or appears before typing, the message takes the queued agent path instead.
 */
export async function sendToShell(d: Deps, target: string, text: string, from: string): Promise<SendResult> {
  const ref = resolveTarget(d, target);
  const rt = d.runtimes.for(ref);
  if ((await rt.probe(ref)).status !== "shell") return send(d, target, text, from);
  if (await rt.typeIntoShell(ref, text)) return "DELIVERED";
  d.store.enqueue(ref, { at: d.now(), from, text });
  return "QUEUED";
}

/**
 * Delivers a session's queued messages as one batch. `held`: only messages held after an ambiguous delivery are left;
 * they wait for a person or the lead (#89). `queued` also when another flush of this session holds its inbox lock: one
 * flush per session at a time, across processes (#108). Throws DeliveryUncertain, having recorded the attempt on the
 * queued messages, when the batch may already have reached the session, and Refusal when the session is gone. A
 * session whose inbox was forwarded (a migration) is flushed at its new ref, old entries merged in first.
 */
export async function flushInbox(d: Deps, from: SessionRef): Promise<"delivered" | "queued" | "no-agent" | "held"> {
  const ref = d.store.forwardOf(from) ?? from;
  if (migrating(d.store.root, from) || migrating(d.store.root, ref)) return "queued";
  if (d.store.queued(ref).length === 0 && !d.store.forwardPending(ref)) return "delivered";
  const release = d.store.lockInbox(ref, d.now());
  if (!release) return "queued";
  try {
    d.store.mergeForwarded(ref);
    return await flushLocked(d, ref);
  } finally {
    release();
  }
}

async function flushLocked(d: Deps, ref: SessionRef): Promise<"delivered" | "queued" | "no-agent" | "held"> {
  // Re-read under the lock: the flush that held it may have delivered these meanwhile.
  const all = d.store.queued(ref);
  if (all.length === 0) return "delivered";
  const queued = all.filter((m) => m.attempt?.state !== "ambiguous");
  const rt = d.runtimes.for(ref);
  // The probe carries the #62 screen check on herdr: an omo with live monitors between turns reads idle.
  const { status } = await rt.probe(ref);
  // Before the held check, so a gone session with only held messages says so instead of delivery-ambiguous forever (#108).
  if (status === "gone") throw new Refusal(`pane ${refText(ref)} is gone; ${all.length} message(s) kept in its inbox`);
  if (queued.length === 0) return "held";
  const typed = queued.filter((m) => m.attempt?.state === "typed");
  if (status === "shell") {
    // The agent the text was typed into is gone from the session: an Enter later would go to another agent's empty input.
    if (typed.length > 0) await holdTyped(d, ref, typed, "the agent left the pane before its Enter");
    return "no-agent";
  }
  if (!READY_TO_READ.includes(status)) return "queued";
  const first = typed[0];
  if (first !== undefined) {
    // An earlier pass typed these and only the Enter failed: press Enter, never type them again (#89), and only into
    // the agent they were typed into (#108).
    const into = {
      ...(first.attempt?.agent !== undefined ? { agent: first.attempt.agent } : {}),
      ...(first.attempt?.pgid !== undefined ? { pgid: first.attempt.pgid } : {}),
    };
    let submitted: Awaited<ReturnType<typeof rt.submitTyped>>;
    try {
      submitted = await rt.submitTyped(ref, into);
    } catch (e) {
      throw new DeliveryUncertain(e, true, into);
    }
    if (submitted === "wait") return "no-agent";
    if (submitted === "changed") {
      await holdTyped(d, ref, typed, "a different agent is in the pane than the one the text was typed into");
      return typed.length === queued.length ? "held" : "queued";
    }
    settleInbox(d, ref, typed);
    // Messages queued after the typed batch were not delivered by this Enter; they wait for the next pass.
    return typed.length === queued.length ? "delivered" : "queued";
  }
  const body =
    queued.length === 1
      ? (queued[0]?.text ?? "")
      : `${queued.length} messages arrived while you were busy:\n\n` +
        queued.map((m, i) => `(${i + 1}) from ${m.from}:\n${m.text}`).join("\n\n");
  const out = await rt.deliver(ref, body);
  switch (out.kind) {
    case "delivered":
      settleInbox(d, ref, queued);
      return "delivered";
    case "no-agent":
      return "no-agent";
    case "not-ready":
      return "queued";
    case "typed":
    case "ambiguous": {
      const e =
        out.kind === "typed"
          ? new DeliveryUncertain(out.failure, true, out.into)
          : new DeliveryUncertain(out.failure, false);
      await recordUncertain(d, ref, queued, e, rt.kind);
      throw e;
    }
  }
}

/** Re-reads the inbox and drops the batch (delivered) or marks it with the failed attempt; messages queued meanwhile stay. */
function settleInbox(d: Deps, ref: SessionRef, batch: readonly QueuedMessage[], attempt?: DeliveryAttempt): void {
  const left = [...batch];
  const rest = d.store.queued(ref).flatMap((m) => {
    const i = left.findIndex((b) => b.at === m.at && b.from === m.from && b.text === m.text);
    if (i < 0) return [m];
    left.splice(i, 1);
    return attempt ? [{ ...m, attempt }] : [];
  });
  d.store.saveInbox(ref, rest);
}

const NOTICE_FROM = "dori-delivery";

/**
 * Records an uncertain delivery on the queued messages. Typed text only waits for its Enter. An ambiguous batch is
 * held and the lead is told once; held messages are never retried, so the notice is never repeated. A notice that
 * itself fails ambiguously is held without another notice, so this cannot loop.
 */
async function recordUncertain(
  d: Deps,
  ref: SessionRef,
  batch: readonly QueuedMessage[],
  e: DeliveryUncertain,
  runtime: string,
): Promise<void> {
  const detail = failureDetail(e);
  settleInbox(d, ref, batch, {
    at: d.now(),
    state: e.typed ? "typed" : "ambiguous",
    detail,
    ...(e.typed ? e.agent : {}),
  });
  if (!e.typed) await noticeHeld(d, ref, batch, `${runtime} said: ${detail}`);
}

/** Typed text whose agent left or changed (#108): it may sit in a lost input, so it is held like an ambiguous batch. */
async function holdTyped(d: Deps, ref: SessionRef, typed: readonly QueuedMessage[], why: string): Promise<void> {
  settleInbox(d, ref, typed, { at: d.now(), state: "ambiguous", detail: why });
  await noticeHeld(d, ref, typed, why);
}

async function noticeHeld(d: Deps, ref: SessionRef, batch: readonly QueuedMessage[], why: string): Promise<void> {
  if (batch.every((m) => m.from === NOTICE_FROM)) return;
  const paneId = refText(ref);
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

/** A session's queued messages, 1-based in inbox order. The text is never shown whole: its first 60 characters, JSON-escaped. */
export function inboxList(d: Deps, target: string): { paneId: string; entries: InboxEntry[] } {
  const ref = resolveTarget(d, target);
  const entries = d.store.queued(ref).map(
    (m, i): InboxEntry => ({
      index: i + 1,
      state: m.attempt?.state === "ambiguous" ? "held" : m.attempt?.state === "typed" ? "typed" : "queued",
      from: m.from,
      at: m.at,
      preview: JSON.stringify(m.text.slice(0, PREVIEW_CHARS)) + (m.text.length > PREVIEW_CHARS ? "..." : ""),
    }),
  );
  return { paneId: refText(ref), entries };
}

/**
 * `ack` drops a held entry (it did arrive); `resend` clears its attempt so the next flush delivers it (it did not).
 * Only held entries: a typed one is in the session's input already, and a queued one is delivered anyway. Runs under
 * the inbox lock, so a flush in progress cannot overwrite the change. Returns the session as refText.
 */
export function releaseHeld(d: Deps, target: string, index: number, how: "ack" | "resend"): string {
  const ref = resolveTarget(d, target);
  const paneId = refText(ref);
  const release = d.store.lockInbox(ref, d.now());
  if (!release) throw new Refusal(`the inbox of ${paneId} is being flushed right now; try again`);
  try {
    const msgs = d.store.queued(ref);
    const m = Number.isInteger(index) ? msgs[index - 1] : undefined;
    if (!m)
      throw new Refusal(
        `no entry ${index} in the inbox of ${paneId} (${msgs.length} entries; see dori inbox list ${target})`,
      );
    if (m.attempt?.state !== "ambiguous")
      throw new Refusal(`entry ${index} of ${paneId} is not held; only held entries can be acked or resent`);
    const { attempt: _, ...fresh } = m;
    d.store.saveInbox(
      ref,
      how === "ack" ? msgs.filter((_, i) => i !== index - 1) : msgs.map((x, i) => (i === index - 1 ? fresh : x)),
    );
    return paneId;
  } finally {
    release();
  }
}
