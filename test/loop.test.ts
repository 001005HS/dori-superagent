import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { done, dutyTick, ready, Refusal, report, startLane } from "../src/harness.ts";
import { backlogAdd, backlogDecide, backlogDrop, backlogImport, HOUR, importId, loopTick } from "../src/loop.ts";
import type { Exec } from "../src/herdr.ts";
import { World } from "./fake.ts";

function setup(opts: { lead?: boolean; exec?: (inner: Exec) => Exec } = {}) {
  const w = new World();
  if (opts.exec) w.exec = opts.exec(w.exec);
  const d = w.deps();
  const lead = w.addPane("w1:p1", "idle");
  if (opts.lead !== false) d.store.setRole("lead", "w1:p1");
  const brief = join(d.store.root, "brief.md");
  writeFileSync(brief, "Do the thing.");
  const add = (id: string, o: Parameters<typeof backlogAdd>[3] = {}) => backlogAdd(d, id, brief, { cwd: d.store.root, ...o });
  const tick = (o: Parameters<typeof loopTick>[1] = {}) => loopTick(d, { force: true, ...o });
  const destructive = () => w.calls.filter((c) => c.argv.join(" ").match(/pane close|pr merge|push/));
  return { w, d, lead, brief, add, tick, destructive };
}

describe("backlog", () => {
  test("add validates, copies the brief, and decide/drop change what the loop may start", async () => {
    const { d, brief, add } = setup();
    expect(() => backlogAdd(d, "Bad Id", brief)).toThrow(Refusal);
    expect(() => backlogAdd(d, "ok-id", brief, { priority: 0 })).toThrow("--priority");
    expect(() => backlogAdd(d, "ok-id", brief, { priority: 10 })).toThrow("--priority");
    expect(() => backlogAdd(d, "ok-id", join(d.store.root, "missing.md"))).toThrow("no brief");
    const item = add("ok-id");
    expect(item).toMatchObject({ status: "open", priority: 5, attempts: 0 });
    expect(readFileSync(item.brief, "utf8")).toBe("Do the thing.");
    expect(() => add("ok-id")).toThrow("already open");

    add("needs-q", { decision: "ship to all users?" });
    backlogDecide(d, "needs-q", "yes, behind a flag");
    const decided = d.store.item("needs-q")!;
    expect(decided.decision).toBeUndefined();
    expect(readFileSync(decided.brief, "utf8")).toContain("yes, behind a flag");

    backlogDrop(d, "ok-id", "not needed");
    expect(d.store.item("ok-id")!.status).toBe("dropped");
    const run = await loopTick(d);
    expect(run.started).toEqual(["needs-q (p5)"]);
  });

  test("import turns labelled issues into items once, with priority and decision labels", async () => {
    const { w, d } = setup();
    w.gh = (argv) => argv[1] === "list"
      ? { code: 0, stdout: JSON.stringify([
          { number: 12, title: "Fix login", body: "steps", labels: [{ name: "dori" }, { name: "p1" }] },
          { number: 13, title: "New billing", body: "", labels: [{ name: "dori" }, { name: "needs-decision" }] },
        ]) }
      : { code: 0, stdout: JSON.stringify({ state: argv[2] === "12" ? "CLOSED" : "OPEN" }) };
    expect(await backlogImport(d, "acme/web-app", "dori", d.store.root)).toEqual({ added: ["web-app-12", "web-app-13"], capped: false });
    expect(d.store.item("web-app-12")).toMatchObject({ priority: 1, source: "acme/web-app#12" });
    expect(readFileSync(d.store.item("web-app-12")!.brief, "utf8")).toContain("issues/12");
    expect(d.store.item("web-app-13")!.decision).toContain("needs-decision");
    expect(await backlogImport(d, "acme/web-app", "dori", d.store.root)).toEqual({ added: [], capped: false });
    await expect(backlogImport(d, "other/web-app", "dori", d.store.root)).rejects.toThrow("already used by acme/web-app#12");
    const run = await loopTick(d);
    expect(run.synced).toEqual(["web-app-12 dropped (acme/web-app#12 closed)"]);
    expect(run.started).toEqual([]);
    expect(run.asked[0]).toStartWith("[DECIDE web-app-13]");
  });
});

describe("hourly loop", () => {
  test("starts by priority, then age, then id, within the per-run and lane budget; skips a second run in the hour", async () => {
    const { w, d, lead, add, destructive } = setup();
    add("old-five");
    w.clock += 1000;
    add("urgent", { priority: 1 });
    w.clock += 1000;
    add("new-five");
    add("aaa-five");
    lead.received.length = 0;

    const run = await loopTick(d, { maxLanes: 3, maxStarts: 2 });
    expect(run.started).toEqual(["urgent (p1)", "old-five (p5)"]);
    expect(run.held).toEqual(["2 item(s) waiting: 1 free of 3 lanes, max 2/run"]);
    expect(d.store.item("urgent")!.status).toBe("running");
    expect(w.panes.get(d.store.lane("urgent")!.paneId)!.ran[0]).toStartWith("omo 'Read your brief at ");
    expect(lead.received.filter((m) => m.startsWith("[START"))).toHaveLength(2);
    const loopMsg = lead.received.find((m) => m.startsWith("[LOOP"))!;
    expect(loopMsg).toContain("lanes 2/3");
    expect(loopMsg).toContain("started: urgent (p1); old-five (p5)");
    expect(d.store.runs()).toHaveLength(1);
    expect(d.store.lastRun()!.at).toBe(run.at);

    w.clock += 10 * 60_000;
    const again = await loopTick(d);
    expect(again.skipped).toBe("ran 10m ago");
    expect(d.store.runs()).toHaveLength(1);

    const forced = await loopTick(d, { force: true, maxLanes: 3 });
    expect(forced.started).toEqual(["aaa-five (p5)"]);
    expect(forced.held).toEqual(["1 item(s) waiting: 0 free of 3 lanes, max 2/run"]);
    w.clock += HOUR;
    expect((await loopTick(d, { maxLanes: 3 })).started).toEqual([]);
    expect(destructive()).toEqual([]);
  });

  test("holds starts when lanes are full, the host is busy, or the item needs a decision", async () => {
    const { w, d, brief, add, tick } = setup();
    add("next");
    add("blocked", { priority: 1, decision: "which database?" });
    await startLane(d, "hand-a", brief, { workspace: "w1" });
    await startLane(d, "hand-b", brief, { workspace: "w1" });
    const full = await tick({ maxLanes: 2 });
    expect(full.started).toEqual([]);
    expect(full.held[0]).toContain("0 free of 2 lanes");
    expect(full.status!.adhoc).toEqual(["hand-a", "hand-b"]);

    w.host = { load1: 20, cores: 8, memFreePct: 50 };
    expect((await tick({ maxLanes: 5 })).held[0]).toBe("host busy: load 20.0 (limit 8), mem free 50%");
    expect((await tick({ maxLanes: 5, maxLoad: 10 })).held[0]).toBe("host busy: load 20.0 (limit 10), mem free 50%");
    w.host = { load1: 1, cores: 8, memFreePct: 5 };
    expect((await tick({ maxLanes: 5 })).held[0]).toContain("mem free 5%");
    w.host = { load1: 1, cores: 8, memFreePct: 50 };
    expect((await tick({ maxLanes: 5 })).started).toEqual(["next (p5)"]);
    expect(d.store.item("blocked")!.status).toBe("open");
  });

  test("sync: done lane closes the item, a lost lane reopens it and asks after two losses, a merged PR closes it", async () => {
    const { w, d, lead, add, tick } = setup();
    add("item-a");
    add("item-b");
    add("item-c");
    await tick({ maxStarts: 3 });

    const a = d.store.lane("item-a")!;
    await ready(d, "item-a", "fixed", ["note.txt"]);
    w.panes.get(a.paneId)!.status = "idle";
    await done(d, "item-a");

    w.panes.delete(d.store.lane("item-b")!.paneId);
    const lost = d.store.lane("item-b")!;
    lost.status = "lost";
    d.store.saveLane(lost);

    await ready(d, "item-c", "PR up", ["https://github.com/acme/app/pull/9"]);
    w.gh = (argv) => ({ code: 0, stdout: JSON.stringify({ state: argv[2] === "9" ? "MERGED" : "OPEN" }) });

    const run = await tick({ maxStarts: 0 });
    expect(run.synced).toEqual([
      "item-a done (lane done)",
      "item-b reopened (lane lost, attempt 1)",
      "item-c done (PR merged)",
    ]);
    expect(run.findings).toContain("item-c READY and its PR merged: dori done item-c");
    expect(d.store.item("item-b")).toMatchObject({ status: "open", attempts: 1 });
    expect(d.store.item("item-b")!.decision).toBeUndefined();

    expect((await tick()).started).toEqual(["item-b (p5)"]);
    const again = d.store.lane("item-b")!;
    again.status = "lost";
    d.store.saveLane(again);
    const second = await tick();
    expect(d.store.item("item-b")!.decision).toBe("lane lost 2 times; retry, re-brief or drop?");
    expect(second.started).toEqual([]);
    expect(lead.received.at(-1)).toContain("[DECIDE item-b] lane lost 2 times");

    w.gh = () => ({ code: 1, stdout: "rate limited" });
    add("item-d", { source: "acme/app#4" });
    const ghDown = await tick();
    expect(ghDown.findings.some((f) => f.startsWith("gh: "))).toBe(true);
    expect(d.store.lastRun()!.at).toBe(ghDown.at);
  });

  test("audit flags stale, long-waiting, unclosed-READY and vanished lanes without touching them", async () => {
    const { w, d, brief, tick, destructive } = setup();
    const quiet = await startLane(d, "quiet", brief, { workspace: "w1" });
    const busy = await startLane(d, "busy", brief, { workspace: "w1" });
    const wait = await startLane(d, "wait-ci", brief, { workspace: "w1" });
    const fin = await startLane(d, "finished", brief, { workspace: "w1" });
    const gone = await startLane(d, "vanished", brief, { workspace: "w1" });
    await startLane(d, "fresh", brief, { workspace: "w1" });
    await report(d, "wait-ci", "WAITING: CI on acme/app#3", "waiting");
    await ready(d, "finished", "done", ["https://github.com/acme/app/pull/3"]);
    for (const l of [quiet, wait, fin]) w.panes.get(l.paneId)!.status = "idle";
    w.panes.get(busy.paneId)!.status = "working";
    w.panes.delete(gone.paneId);
    w.gh = () => ({ code: 0, stdout: JSON.stringify({ state: "OPEN" }) });

    w.clock += 30 * 60_000;
    expect((await tick({ maxStarts: 0 })).findings).toEqual(["vanished pane " + gone.paneId + " is gone"]);
    w.clock += 4 * HOUR;
    await dutyTick(d);
    expect(d.store.lane("busy")!.lastActivityAt).toBe(w.clock);
    const lanesBefore = readdirSync(join(d.store.root, "lanes")).map((f) => readFileSync(join(d.store.root, "lanes", f), "utf8"));
    const run = await tick({ maxStarts: 0 });
    expect(run.findings.sort()).toEqual([
      "busy working, no report for 4h",
      "finished READY 4h ago, not closed: dori done finished",
      "fresh working, no report for 4h",
      "quiet working, no report for 4h",
      "wait-ci waiting 4h on: WAITING: CI on acme/app#3",
    ]);
    const lanesAfter = readdirSync(join(d.store.root, "lanes")).map((f) => readFileSync(join(d.store.root, "lanes", f), "utf8"));
    expect(lanesAfter).toEqual(lanesBefore);
    expect(destructive()).toEqual([]);
  });

  test("a decision is asked once, reminded once after 6 hours, then left alone until answered", async () => {
    const { w, d, lead, add } = setup();
    add("pick-db", { decision: "postgres or sqlite?" });
    const at = async (h: number) => { w.clock += h * HOUR; return loopTick(d); };
    expect((await at(0)).asked).toEqual(["[DECIDE pick-db] postgres or sqlite? -> dori backlog decide pick-db --text '...' | dori backlog drop pick-db"]);
    expect((await at(1)).asked).toEqual([]);
    expect((await at(5)).asked[0]).toStartWith("(reminder) [DECIDE pick-db]");
    expect((await at(6)).asked).toEqual([]);
    expect(lead.received.filter((m) => m.includes("[DECIDE pick-db]"))).toHaveLength(2);
    backlogDecide(d, "pick-db", "sqlite");
    expect((await at(1)).started).toEqual(["pick-db (p5)"]);
  });

  test("kill switch: a stopped loop does nothing at all; a live lock skips, a dead or corrupt one is taken over", async () => {
    const { w, d, lead, add, tick } = setup();
    add("work");
    d.store.setStop(1, "maintenance");
    lead.received.length = 0;
    const stopped = await tick();
    expect(stopped.skipped).toBe("stopped: maintenance");
    expect(d.store.runs()).toEqual([]);
    expect(lead.received).toEqual([]);
    expect(d.store.item("work")!.status).toBe("open");
    d.store.clearStop();

    writeFileSync(d.store.loopPath("lock"), JSON.stringify({ pid: process.ppid, at: 0, nonce: "other" }));
    expect((await tick()).skipped).toBe(`locked by pid ${process.ppid}`);
    expect(readFileSync(d.store.loopPath("lock"), "utf8")).toContain('"other"');
    writeFileSync(d.store.loopPath("lock"), "{\"pid\": 12");
    expect((await tick()).started).toEqual(["work (p5)"]);
    writeFileSync(d.store.loopPath("lock"), JSON.stringify({ pid: 2147483647, at: 0, nonce: "dead" }));
    w.clock += HOUR;
    expect((await tick()).started).toEqual([]);
    expect(readdirSync(join(d.store.root, "loop")).filter((f) => f.startsWith("lock"))).toEqual([]);
  });

  test("a failed lane start is recorded and stops pulling; with no lead nothing starts", async () => {
    const failing = setup({
      exec: (inner) => async (cmd, argv) => (cmd === "herdr" && argv[0] === "tab" ? { code: 1, stdout: "", stderr: "server down" } : inner(cmd, argv)),
    });
    failing.add("one");
    failing.add("two");
    const run = await failing.tick();
    expect(run.started).toEqual([]);
    expect(run.findings).toEqual([expect.stringContaining("start one failed: herdr tab create")]);
    expect(failing.d.store.item("one")).toMatchObject({ status: "open", attempts: 1 });
    expect(failing.d.store.lastRun()!.at).toBe(run.at);
    expect(readdirSync(join(failing.d.store.root, "loop"))).not.toContain("lock");

    const headless = setup({ lead: false });
    headless.add("one");
    const quiet = await headless.tick();
    expect(quiet.held).toEqual(["no lead pane registered"]);
    expect(quiet.started).toEqual([]);
    expect(headless.d.store.runs()).toHaveLength(1);
  });
});

describe("hardening", () => {
  test("ids from the CLI cannot leave the backlog directory, and long imported ids stay valid and distinct", async () => {
    const { d } = setup();
    expect(() => backlogDecide(d, "../lanes/x", "yes")).toThrow(Refusal);
    expect(() => backlogDrop(d, "../../etc", "x")).toThrow(Refusal);
    const a = importId("acme/a-very-long-repository-name-that-keeps-going", 12345);
    const b = importId("other/a-very-long-repository-name-that-keeps-going", 12345);
    expect(a).toMatch(/^[a-z][a-z0-9-]{1,40}$/);
    expect(a).not.toBe(b);
    expect(importId("acme/web-app", 7)).toBe("web-app-7");
  });

  test("a running item whose lane record vanished is reopened, not marked done", async () => {
    const { d, add, tick } = setup();
    add("ghost");
    await tick();
    rmSync(join(d.store.root, "lanes", "ghost.json"));
    const run = await tick();
    expect(run.synced[0]).toBe("ghost reopened (lane record missing, attempt 1)");
    expect(d.store.item("ghost")!.status).not.toBe("done");
  });

  test("a lane that opened but whose [START] could not reach the lead counts as started", async () => {
    const { d, add, tick } = setup({
      exec: (inner) => async (cmd, argv) =>
        cmd === "herdr" && argv[0] === "agent" && argv[2] === "w1:p1" ? { code: 1, stdout: "", stderr: "lead pane hung" } : inner(cmd, argv),
    });
    add("solo");
    const run = await tick({ maxStarts: 1 });
    expect(run.started).toEqual(["solo (p5)"]);
    expect(d.store.item("solo")!.status).toBe("running");
    expect(run.findings.some((f) => f.startsWith("solo started in ") && f.includes("lead was not told"))).toBe(true);
    expect(run.findings.some((f) => f.startsWith("report to the lead failed"))).toBe(true);
    expect(d.store.lastRun()!.findings).toEqual(run.findings);
  });

  test("a loop that loses its lock mid-run starts nothing more and leaves the new holder's lock in place", async () => {
    let home = "";
    const { d, add, tick } = setup({
      exec: (inner) => async (cmd, argv) => {
        if (cmd === "herdr" && argv[0] === "tab") {
          writeFileSync(join(home, "loop", "lock"), JSON.stringify({ pid: process.ppid, at: 0, nonce: "usurper" }));
        }
        return inner(cmd, argv);
      },
    });
    home = d.store.root;
    add("first");
    add("second");
    const run = await tick({ maxStarts: 2 });
    expect(run.started).toEqual(["first (p5)"]);
    expect(run.held).toContain("lock lost to another loop; no more starts this run");
    expect(readFileSync(d.store.loopPath("lock"), "utf8")).toContain("usurper");
  });

  test("two runs in the same millisecond keep two records", async () => {
    const { d, tick } = setup();
    await tick();
    await tick();
    expect(d.store.runs()).toHaveLength(2);
  });
});
