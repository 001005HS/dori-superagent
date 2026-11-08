import { describe, expect, test } from "bun:test";
import { HcError, hcCall } from "../src/runtime/hc/exec.ts";
import { HcRuntime } from "../src/runtime/hc/index.ts";
import { parseProbe } from "../src/runtime/hc/probe.ts";
import { slugName } from "../src/runtime/hc/sessions.ts";
import type { CreateSpec, DeliverOutcome, SessionRef } from "../src/runtime/types.ts";
import { openSession } from "../src/runtime/types.ts";
import { FakeHc, type FakeTerminal, terminal } from "./hc-fake.ts";

const T1: SessionRef = { runtime: "hc", id: "t1" };

function rig(initial: Record<string, FakeTerminal> = {}, env: Record<string, string | undefined> = {}) {
  const fake = new FakeHc(initial);
  const sleeps: number[] = [];
  const logs: string[] = [];
  const rt = new HcRuntime(fake.exec, { env, sleep: async (ms) => void sleeps.push(ms), log: (line) => void logs.push(line) });
  return { fake, rt, sleeps, logs };
}

const lane: CreateSpec = { name: "Lane K", cwd: "/w", env: { A: "1", B: "it's a b" }, role: "lane", container: "tab", group: "g1" };
const SH = { SHELL: "/bin/zsh" };

describe("create / start / createGroup", () => {
  test("create argv is exact: background, no parent, no notes, labels, slug name, env utility then the user's shell", async () => {
    const { fake, rt } = rig({}, SH);
    const ref = await rt.create(lane);
    expect(ref).toEqual({ runtime: "hc", id: "t1", group: "g1" });
    expect(fake.calls).toEqual([
      ["ls"],
      ["run", "--bg", "--no-parent", "--no-notify", "--cwd", "/w", "--label", "dori.group=g1", "--label", "dori.role=lane", "--label", "dori.name=Lane K", "--label", "dori.lane=Lane K", "--name", "lane-k", "--", "env", "A=1", "B=it's a b", "/bin/zsh"],
    ]);
  });

  test("no group labels dori.group=dori; a non-lane role has no dori.lane label; no SHELL runs sh", async () => {
    const { fake, rt } = rig();
    const ref = await rt.create({ name: "lead", cwd: "/r", env: {}, role: "lead", container: "workspace-root" });
    expect(ref).toEqual({ runtime: "hc", id: "t1", group: "dori" });
    expect(fake.calls[1]).toEqual(["run", "--bg", "--no-parent", "--no-notify", "--cwd", "/r", "--label", "dori.group=dori", "--label", "dori.role=lead", "--label", "dori.name=lead", "--name", "lead", "--", "env", "sh"]);
  });

  test("start sends the command into the shell with no status gate", async () => {
    const { fake, rt } = rig({ t1: terminal({ status: null, reported: false }) });
    await rt.start(T1, "omo --x 'a b'");
    expect(fake.calls).toEqual([["send", "t1", "--", "omo --x 'a b'"]]);
  });

  test("openSession is create then start", async () => {
    const { fake, rt } = rig({}, SH);
    expect(await openSession(rt, lane, "omo")).toEqual({ runtime: "hc", id: "t1", group: "g1" });
    expect(fake.calls.map((c) => c[0])).toEqual(["ls", "run", "send"]);
    expect(fake.calls[2]).toEqual(["send", "t1", "--", "omo"]);
  });

  test("createGroup returns the label and makes no call", async () => {
    const { fake, rt } = rig();
    expect(await rt.createGroup("abcd1234", "/w")).toBe("abcd1234");
    expect(fake.calls).toEqual([]);
  });

  test("a live terminal holding the slug drops --name (hc names are unique among live terminals)", async () => {
    const { fake, rt } = rig({ t1: terminal({ name: "lane-k" }) });
    expect(await rt.create(lane)).toEqual({ runtime: "hc", id: "t2", group: "g1" });
    expect(fake.calls[1]).not.toContain("--name");
  });

  test("a finished terminal with the same name does not block the name", async () => {
    const { fake, rt } = rig({ t1: terminal({ name: "lane-k", state: "finished" }) });
    await rt.create(lane);
    expect(fake.calls[1]).toContain("--name");
  });

  test("a name taken between ls and run is retried once without --name", async () => {
    const { fake, rt } = rig();
    fake.knobs.nameTaken = true;
    expect(await rt.create(lane)).toEqual({ runtime: "hc", id: "t1", group: "g1" });
    expect(fake.calls.filter((c) => c[0] === "run").map((c) => c.includes("--name"))).toEqual([true, false]);
  });

  test("an env key that is not a shell name is refused before anything runs", async () => {
    const { fake, rt } = rig();
    await expect(rt.create({ ...lane, env: { "-i": "x" } })).rejects.toThrow(/-i/);
    expect(fake.calls.some((c) => c[0] === "run")).toBe(false);
  });
});

describe("slugName", () => {
  test.each([
    ["Lane K", "lane-k"],
    ["my lane/ünïcode!!", "my-lane--n-code--"],
    ["a.b_c-d", "a.b_c-d"],
    ["x".repeat(40), "x".repeat(32)],
    ["", undefined],
  ] as const)("%p -> %p", (name, want) => {
    expect(slugName(name)).toBe(want);
  });
});

describe("probe", () => {
  test.each([
    ["idle", terminal(), { status: "idle", agent: "omo", pgid: 4242, rootPid: 900, turn: 3, title: "omo lane", cwd: "/w", shellInFront: false }],
    ["working", terminal({ status: { state: "working", app: "omo" } }), { status: "working", agent: "omo" }],
    ["blocked", terminal({ status: { state: "blocked", app: "omo" } }), { status: "blocked" }],
    ["error", terminal({ status: { state: "error", app: "omo" } }), { status: "error" }],
    ["done", terminal({ status: { state: "done", app: "omo" } }), { status: "done" }],
    ["unreported shell", terminal({ status: null, reported: false, foreground: { name: "bash", argv: ["/bin/bash"], pid: 7 } }), { status: "shell", agent: "bash", pgid: 7, shellInFront: true }],
    ["unreported program", terminal({ status: null, reported: false, foreground: { name: "node", argv: ["node", "x.js"], pid: 8 } }), { status: "unknown", agent: "node", shellInFront: false }],
    ["finished", terminal({ state: "finished" }), { status: "gone" }],
    ["unknown word", terminal({ status: { state: "thinking" } }), { status: "unknown", agent: "omo" }],
  ] as const)("%s", async (_, t, want) => {
    const { rt } = rig({ t1: t });
    expect(await rt.probe(T1)).toMatchObject(want);
  });

  test("a terminal hc does not know is gone", async () => {
    const { rt } = rig();
    expect(await rt.probe(T1)).toEqual({ status: "gone", shellInFront: false });
  });

  test("any other get failure throws an HcError carrying hc's kind and hint", async () => {
    const { fake, rt } = rig({ t1: terminal() });
    fake.knobs.getError = "unavailable";
    const err = await rt.probe(T1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HcError);
    expect(err).toMatchObject({ kind: "unavailable", hint: "hint for unavailable" });
  });

  test("parseProbe reads hc's own get shape (the live bash terminal this host has)", () => {
    const live = { address: "t1", argv: ["/bin/bash"], cwd: "/h", foreground: { argv: ["/bin/bash"], cwd: "/h", name: "bash", pid: 11 }, pid: 11, reported: false, state: "live", status: null, title: "u@h: ~", turn: 0 };
    expect(parseProbe(live)).toEqual({ status: "shell", agent: "bash", pgid: 11, rootPid: 11, turn: 0, title: "u@h: ~", cwd: "/h", shellInFront: true, foreground: [{ name: "bash", argv: ["/bin/bash"], pid: 11 }] });
  });
});

describe("deliver", () => {
  test("idle: send --if idle once, delivered with turn and started", async () => {
    const { fake, rt } = rig({ t1: terminal() });
    expect(await rt.deliver(T1, "hello")).toEqual({ kind: "delivered", turn: 4, started: true });
    expect(fake.calls.filter((c) => c[0] === "send")).toEqual([["send", "t1", "--if", "idle", "--", "hello"]]);
  });

  test("done: a plain send (the agent finished its turn and waits)", async () => {
    const { fake, rt } = rig({ t1: terminal({ status: { state: "done", app: "omo" } }) });
    expect((await rt.deliver(T1, "next")).kind).toBe("delivered");
    expect(fake.calls.filter((c) => c[0] === "send")).toEqual([["send", "t1", "--", "next"]]);
  });

  test("started:false is still delivered; started:null leaves started out", async () => {
    const a = rig({ t1: terminal() });
    a.fake.knobs.started = false;
    expect(await a.rt.deliver(T1, "x")).toEqual({ kind: "delivered", turn: 4, started: false });
    const b = rig({ t1: terminal() });
    b.fake.knobs.started = null;
    expect(await b.rt.deliver(T1, "x")).toEqual({ kind: "delivered", turn: 4 });
  });

  test.each([
    ["shell in front, unreported", terminal({ status: null, reported: false, foreground: { name: "bash", argv: ["bash"], pid: 1 } }), { kind: "no-agent" }],
    ["shell in front while the agent last reported idle (suspended agent)", terminal({ foreground: { name: "zsh", argv: ["-zsh"], pid: 1 } }), { kind: "no-agent" }],
    ["finished", terminal({ state: "finished" }), { kind: "no-agent" }],
    ["blocked without force", terminal({ status: { state: "blocked" } }), { kind: "not-ready", status: "blocked" }],
    ["error without force", terminal({ status: { state: "error" } }), { kind: "not-ready", status: "error" }],
  ] as const)("pre-probe %s: no send at all", async (_, term, want) => {
    const { fake, rt } = rig({ t1: term });
    expect(await rt.deliver(T1, "secret text")).toEqual(want);
    expect(fake.calls.some((c) => c[0] === "send")).toBe(false);
  });

  test.each([
    ["working", terminal({ status: { state: "working" } }), "working"],
    ["unreported program", terminal({ status: null, reported: false, foreground: { name: "node", argv: ["node"], pid: 1 } }), "unknown"],
  ] as const)("%s under the default when=idle: hc refuses the compare-and-send, nothing typed", async (_, term, status) => {
    const { fake, rt } = rig({ t1: term });
    expect(await rt.deliver(T1, "x")).toEqual({ kind: "not-ready", status });
    expect(fake.calls.filter((c) => c[0] === "send")).toEqual([["send", "t1", "--if", "idle", "--", "x"]]);
    expect(fake.sent).toEqual([]);
  });

  test("when=working sends --if working", async () => {
    const { fake, rt } = rig({ t1: terminal({ status: { state: "working", app: "omo" } }) });
    expect((await rt.deliver(T1, "/goal pause", { when: "working" })).kind).toBe("delivered");
    expect(fake.calls.filter((c) => c[0] === "send")).toEqual([["send", "t1", "--if", "working", "--", "/goal pause"]]);
  });

  test("when=any sends with no status gate", async () => {
    const { fake, rt } = rig({ t1: terminal({ status: { state: "working", app: "omo" } }) });
    expect((await rt.deliver(T1, "x", { when: "any" })).kind).toBe("delivered");
    expect(fake.calls.filter((c) => c[0] === "send")).toEqual([["send", "t1", "--", "x"]]);
  });

  test("force types into a blocked agent with --force", async () => {
    const { fake, rt } = rig({ t1: terminal({ status: { state: "blocked", app: "omo" } }) });
    expect((await rt.deliver(T1, "y", { when: "any", force: true })).kind).toBe("delivered");
    expect(fake.calls.filter((c) => c[0] === "send")).toEqual([["send", "t1", "--force", "--", "y"]]);
  });

  test.each([
    ["status_mismatch", "not-ready"],
    ["blocked", "not-ready"],
    ["not_found", "no-agent"],
    ["finished", "no-agent"],
    ["unavailable", "ambiguous"],
  ] as const)("send answering %s -> %s", async (kind, want) => {
    const { fake, rt } = rig({ t1: terminal() });
    fake.knobs.sendError = kind;
    const out = await rt.deliver(T1, "secret text");
    expect(out.kind).toBe(want);
    expect(fake.sent).toEqual([]);
  });

  test("not-ready after a refused send carries the status hc reports now", async () => {
    const { fake, rt } = rig({ t1: terminal() });
    fake.knobs.sendError = "blocked";
    expect(await rt.deliver(T1, "x")).toEqual({ kind: "not-ready", status: "blocked" });
  });

  const transport: [string, (f: FakeHc) => void][] = [
    ["a non-JSON failure", (f) => void (f.knobs.sendGarbled = true)],
    ["a runner that throws", (f) => void (f.knobs.sendThrows = true)],
    ["an unavailable core", (f) => void (f.knobs.sendError = "unavailable")],
  ];
  test.each(transport)("%s is ambiguous and never carries the text", async (_, arm) => {
    const { fake, rt } = rig({ t1: terminal() });
    arm(fake);
    const out: DeliverOutcome = await rt.deliver(T1, "secret text");
    if (out.kind !== "ambiguous") throw new Error(`expected ambiguous, got ${out.kind}`);
    expect(out.detail.length).toBeGreaterThan(0);
    expect(out.detail).not.toContain("secret text");
    expect(String(out.failure instanceof Error ? out.failure.message : out.failure)).not.toContain("secret text");
  });
});

describe("typed text, shells, keys", () => {
  test("submitTyped is always changed and touches nothing (hc sends paste+Enter atomically)", async () => {
    const { fake, rt } = rig({ t1: terminal() });
    expect(await rt.submitTyped(T1, { agent: "omo", pgid: 4242 })).toBe("changed");
    expect(fake.calls).toEqual([]);
  });

  test("typeIntoShell sends into an unreported shell without a status gate", async () => {
    const { fake, rt } = rig({ t1: terminal({ status: null, reported: false, foreground: { name: "zsh", argv: ["-zsh"], pid: 2 } }) });
    expect(await rt.typeIntoShell(T1, "ls -la")).toBe(true);
    expect(fake.calls.filter((c) => c[0] === "send")).toEqual([["send", "t1", "--", "ls -la"]]);
  });

  test("typeIntoShell refuses when an agent is in front", async () => {
    const { fake, rt } = rig({ t1: terminal() });
    expect(await rt.typeIntoShell(T1, "rm -rf x")).toBe(false);
    expect(fake.sent).toEqual([]);
  });

  test("keys map escape to esc in one call", async () => {
    const { fake, rt } = rig({ t1: terminal() });
    await rt.keys(T1, ["escape", "enter"]);
    expect(fake.calls).toEqual([["keys", "t1", "esc", "enter"]]);
  });

  test("read asks for history lines and returns the text", async () => {
    const { fake, rt } = rig({ t1: terminal({ screen: "line a\nline b" }) });
    expect(await rt.read(T1, 40)).toBe("line a\nline b");
    expect(fake.calls).toEqual([["read", "t1", "--lines", "40"]]);
  });
});

describe("close, list, self", () => {
  test("close kills then removes, whatever the scope", async () => {
    const { fake, rt, sleeps } = rig({ t1: terminal() });
    await rt.close(T1, "container");
    expect(fake.calls).toEqual([["kill", "t1"], ["rm", "t1"]]);
    expect(sleeps).toEqual([]);
    expect(fake.terminals.has("t1")).toBe(false);
  });

  test("rm answering live is retried every 200 ms until it goes", async () => {
    const { fake, rt, sleeps } = rig({ t1: terminal() });
    fake.knobs.liveAfterKill = 2;
    await rt.close(T1);
    expect(fake.calls.filter((c) => c[0] === "rm")).toHaveLength(3);
    expect(sleeps).toEqual([200, 200]);
  });

  test("still live after 5 retries is logged, not thrown", async () => {
    const { fake, rt, sleeps, logs } = rig({ t1: terminal() });
    fake.knobs.liveAfterKill = 99;
    await rt.close(T1);
    expect(fake.calls.filter((c) => c[0] === "rm")).toHaveLength(6);
    expect(sleeps).toEqual([200, 200, 200, 200, 200]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("t1");
  });

  test("closing a terminal hc no longer knows is a no-op", async () => {
    const { rt } = rig();
    await rt.close(T1);
  });

  test("list filters by the dori.group label and keeps only this core's terminals", async () => {
    const { fake, rt } = rig({ t1: terminal({ labels: { "dori.group": "g1" } }), t2: terminal({ labels: { "dori.group": "g2" } }), t3: terminal({ labels: { "dori.group": "g1" } }) });
    expect(await rt.list({ group: "g1" })).toEqual([
      { ref: { runtime: "hc", id: "t1", group: "g1" }, cwd: "/w", status: "idle", agent: "omo" },
      { ref: { runtime: "hc", id: "t3", group: "g1" }, cwd: "/w", status: "idle", agent: "omo" },
    ]);
    expect(fake.calls).toEqual([["ls", "--label", "dori.group=g1"]]);
  });

  test("list without a group lists every live local terminal", async () => {
    const { fake, rt } = rig({ t1: terminal(), t2: terminal({ state: "finished" }) });
    expect(await rt.list()).toEqual([{ ref: { runtime: "hc", id: "t1" }, cwd: "/w", status: "idle", agent: "omo" }]);
    expect(fake.calls).toEqual([["ls"]]);
  });

  test("self comes from HC_TERMINAL_ID", () => {
    expect(rig({}, { HC_TERMINAL_ID: "t9" }).rt.self()).toEqual({ runtime: "hc", id: "t9" });
    expect(rig({}, {}).rt.self()).toBeUndefined();
    expect(rig({}, { HC_TERMINAL_ID: "" }).rt.self()).toBeUndefined();
  });

  test("kind is hc", () => {
    expect(rig().rt.kind).toBe("hc");
  });
});

describe("hcCall", () => {
  test("parses hc's error JSON from stderr, hint either at error.hint or error.data.hint", async () => {
    const exec = async () => ({ code: 3, stdout: "", stderr: JSON.stringify({ error: { kind: "not_found", message: "no terminal", data: { hint: "see ls" } } }) });
    const err = await hcCall(exec, ["get", "t5"]).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: "not_found", hint: "see ls", reason: "no terminal" });
  });

  test("redacts the delivered text; with no JSON the kind falls back to hc's exit-code table", async () => {
    const exec = async () => ({ code: 5, stdout: "", stderr: "boom" });
    const err = (await hcCall(exec, ["send", "t1", "--", "secret text"], { redact: "secret text" }).catch((e: unknown) => e)) as HcError;
    expect(err.kind).toBe("unavailable");
    expect(err.argv).toEqual(["--json", "send", "t1", "--", "<text>"]);
    expect(err.message).not.toContain("secret text");
  });
});
