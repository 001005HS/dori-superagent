import { describe, expect, test } from "bun:test";
import { dutyTick, send } from "../src/harness.ts";
import { World } from "./fake.ts";

// #89: a delivery that failed after the text may already have reached the pane is never re-sent blindly.

const NOT_READY = '{"error":{"code":"agent_not_ready"}}';

function setup() {
  const w = new World();
  const d = w.deps();
  const lead = w.addPane("w1:p1", "idle");
  d.store.setRole("lead", "w1:p1");
  const count = (pane: string, group: string, verb: string) =>
    w.calls.filter((c) => c.argv[0] === group && c.argv[1] === verb && c.argv[2] === pane).length;
  return { w, d, lead, count };
}

describe("typed fallback whose Enter failed (#89 A)", () => {
  test("Enter fails 3 times: the next dutyTick presses only Enter and never types the text again", async () => {
    const { w, d, lead, count } = setup();
    w.promptFails.set("w1:p1", NOT_READY);
    w.keyFails = 3;
    await expect(send(d, "lead", "IMPORTANT MESSAGE", "cli")).rejects.toThrow("key press failed");
    expect(count("w1:p1", "pane", "send-text")).toBe(1);
    expect(count("w1:p1", "pane", "send-keys")).toBe(3);

    expect(await dutyTick(d)).toEqual([{ pane: "w1:p1", action: "flushed" }]);
    expect(count("w1:p1", "pane", "send-text")).toBe(1);
    expect(count("w1:p1", "pane", "send-keys")).toBe(4);
    expect(w.calls.at(-1)!.argv).toEqual(["pane", "send-keys", "w1:p1", "enter"]);
    expect(lead.received).toEqual(["IMPORTANT MESSAGE"]);
    expect(d.store.queued("w1:p1")).toEqual([]);

    expect(await dutyTick(d)).toEqual([]);
    expect(count("w1:p1", "pane", "send-text")).toBe(1);
    expect(count("w1:p1", "pane", "send-keys")).toBe(4);
  });

  test("the pending Enter is held while a shell is in front, and pressed once the agent is back", async () => {
    const { w, d, lead, count } = setup();
    w.promptFails.set("w1:p1", NOT_READY);
    w.keyFails = 3;
    await expect(send(d, "lead", "IMPORTANT MESSAGE", "cli")).rejects.toThrow("key press failed");

    lead.status = "shell";
    expect(await dutyTick(d)).toContainEqual(expect.objectContaining({ pane: "w1:p1", action: "inbox-held" }));
    lead.status = "idle";
    lead.foreground = "-zsh";
    expect(await dutyTick(d)).toContainEqual(expect.objectContaining({ pane: "w1:p1", action: "inbox-held" }));
    expect(count("w1:p1", "pane", "send-keys")).toBe(3);

    lead.foreground = undefined;
    expect(await dutyTick(d)).toEqual([{ pane: "w1:p1", action: "flushed" }]);
    expect(count("w1:p1", "pane", "send-keys")).toBe(4);
    expect(count("w1:p1", "pane", "send-text")).toBe(1);
  });
});

describe("ambiguous `agent prompt` failure (#89 B)", () => {
  test("a non-agent_not_ready error: the lead is told exactly once across several dutyTicks and the prompt is not re-sent", async () => {
    const { w, d, lead, count } = setup();
    const lane = w.addPane("w1:p2", "idle");
    w.promptFails.set("w1:p2", "timeout");
    d.store.enqueue("w1:p2", { at: w.clock, from: "cli", text: "SECRET instruction" });

    const ticks = [await dutyTick(d), await dutyTick(d), await dutyTick(d)];
    for (const events of ticks) {
      expect(events).toContainEqual(expect.objectContaining({ pane: "w1:p2", action: "delivery-ambiguous" }));
      expect(events.some((e) => e.action === "flush-failed")).toBe(false);
      expect(JSON.stringify(events)).not.toContain("SECRET");
    }
    expect(count("w1:p2", "agent", "prompt")).toBe(1);
    expect(count("w1:p2", "pane", "send-text")).toBe(0);
    expect(lane.received).toEqual([]);
    const notices = lead.received.filter((m) => m.includes("w1:p2"));
    expect(notices).toHaveLength(1);
    expect(notices[0]).not.toContain("SECRET");
    expect(d.store.queued("w1:p2")).toHaveLength(1);
  });

  test("an ambiguous failure on the lead's own pane is held and not re-sent, with no notice loop", async () => {
    const { w, d, lead, count } = setup();
    w.promptFails.set("w1:p1", "timeout");
    await expect(send(d, "lead", "hello", "cli")).rejects.toThrow("timeout");
    for (let i = 0; i < 3; i++) await dutyTick(d);
    w.promptFails.delete("w1:p1");
    expect(await dutyTick(d)).toContainEqual(expect.objectContaining({ pane: "w1:p1", action: "delivery-ambiguous" }));
    // one prompt for the message, one for the notice about it; neither is retried
    expect(count("w1:p1", "agent", "prompt")).toBe(2);
    expect(lead.received).toEqual([]);
  });
});

describe("control", () => {
  test("normal delivery is unchanged: delivered once through agent prompt, nothing typed, inbox empty", async () => {
    const { w, d, lead, count } = setup();
    expect(await send(d, "lead", "hello", "cli")).toBe("DELIVERED");
    expect(lead.received).toEqual(["hello"]);
    expect(count("w1:p1", "agent", "prompt")).toBe(1);
    expect(count("w1:p1", "pane", "send-text")).toBe(0);
    expect(d.store.queued("w1:p1")).toEqual([]);
    expect(await dutyTick(d)).toEqual([]);
    expect(count("w1:p1", "agent", "prompt")).toBe(1);
  });
});
