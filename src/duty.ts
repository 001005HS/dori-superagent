import { DeliveryUncertain, HerdrError } from "./herdr.ts";
import { prompt, Refusal, sendOrThrow, tellLead, type Deps } from "./harness.ts";
import { runHook } from "./hooks.ts";
import { flushInbox } from "./inbox.ts";

export const NUDGE_MINUTES = [10, 20, 40] as const;

export type DutyEvent = { lane?: string; pane?: string; action: string; detail?: string };

/** A short one-line reason. A HerdrError message carries the whole argv (the queued text), so use herdr's own output. */
export function failureDetail(e: unknown): string {
  if (e instanceof DeliveryUncertain) e = e.failure;
  const raw = e instanceof HerdrError ? e.result.stderr || e.result.stdout : e instanceof Error ? e.message : String(e);
  const first = raw.trim().split("\n")[0] ?? "";
  return first.length > 200 ? `${first.slice(0, 200)}...` : first;
}

/** One proactive pass: flush inboxes of panes that became idle, nudge silent lanes, escalate, detect lost panes. */
export async function dutyTick(d: Deps): Promise<DutyEvent[]> {
  // Kill switch: a stopped duty loop delivers, nudges and escalates nothing. Queued messages wait for the resume.
  const stop = d.store.stop("duty");
  if (stop) return [{ action: "stopped", detail: stop.reason }];
  const events: DutyEvent[] = [];
  for (const paneId of d.store.inboxPanes()) {
    try {
      const result = await flushInbox(d, paneId);
      if (result === "delivered") events.push({ pane: paneId, action: "flushed" });
      if (result === "no-agent") {
        events.push({
          pane: paneId,
          action: "inbox-held",
          detail: `no agent in front; ${d.store.queued(paneId).length} message(s) kept`,
        });
      }
      // Held after an ambiguous delivery (#89): shown on every pass, resent never; the lead was told once.
      const held = d.store.queued(paneId).filter((m) => m.attempt?.state === "ambiguous").length;
      if (held > 0)
        events.push({ pane: paneId, action: "delivery-ambiguous", detail: `${held} message(s) held, not resent` });
    } catch (e) {
      // One pane's failed delivery must never kill the loop for every other pane and lane.
      if (e instanceof Refusal) events.push({ pane: paneId, action: "inbox-target-gone" });
      else if (e instanceof DeliveryUncertain && !e.typed)
        events.push({ pane: paneId, action: "delivery-ambiguous", detail: failureDetail(e) });
      else events.push({ pane: paneId, action: "flush-failed", detail: failureDetail(e) });
    }
  }
  for (const lane of d.store.lanes()) {
    if (lane.status !== "working" && lane.status !== "waiting") continue;
    try {
      const st = await d.herdr.status(lane.paneId);
      const now = d.now();
      if (st === "gone") {
        lane.status = "lost";
        lane.log.push({ at: now, kind: "lost", text: "pane disappeared without READY" });
        d.store.saveLane(lane);
        void runHook(d, "onLost", { key: lane.key, text: "pane disappeared without READY", evidence: "" });
        await tellLead(d, `[LOST ${lane.key}] pane ${lane.paneId} closed without a final answer`, "duty");
        events.push({ lane: lane.key, action: "lost" });
        continue;
      }
      if (st === "working") {
        lane.lastActivityAt = now;
        d.store.saveLane(lane);
        continue;
      }
      if (lane.status === "waiting" || st === "blocked") continue;
      const idleMin = (now - lane.lastActivityAt) / 60_000;
      const due = NUDGE_MINUTES[lane.nudges];
      if (due === undefined || idleMin < due) continue;
      lane.nudges += 1;
      lane.log.push({ at: now, kind: "nudge", text: `idle ${Math.floor(idleMin)} min` });
      d.store.saveLane(lane);
      if (lane.nudges < NUDGE_MINUTES.length) {
        await sendOrThrow(
          d,
          lane.key,
          prompt("nudge.md", { key: lane.key, minutes: String(Math.floor(idleMin)), dori: d.doriCmd }),
          "duty",
        );
        events.push({ lane: lane.key, action: `nudge-${lane.nudges}` });
      } else {
        await tellLead(
          d,
          `[ESCALATE ${lane.key}] idle ${Math.floor(idleMin)} min with no READY after ${lane.nudges - 1} nudges`,
          "duty",
        );
        events.push({ lane: lane.key, action: "escalated" });
      }
    } catch (e) {
      // One lane's failed status read or delivery must not end the loop for the other lanes.
      events.push({ lane: lane.key, action: "lane-failed", detail: failureDetail(e) });
    }
  }
  const count = (pred: (a: string) => boolean) => events.filter((e) => pred(e.action)).length;
  d.usage.touch();
  d.usage.duty({
    ticks: 1,
    flushed: count((a) => a === "flushed"),
    nudges: count((a) => a.startsWith("nudge-")),
    escalations: count((a) => a === "escalated"),
    lost: count((a) => a === "lost"),
  });
  return events;
}
