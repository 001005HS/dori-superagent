// The hourly loop: sync the backlog with live lanes, audit for missed work, start the next item
// that needs no decision, ask the lead the open questions, and record the run. It never merges,
// never pushes, never closes a pane and never edits a lane record. See docs/hourly-loop.md.
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { KEY_RE, Refusal, startLane, tellLead, type Deps } from "./harness.ts";
import type { Item, LoopRun } from "./store.ts";

export const HOUR = 3_600_000;
export const STALE_HOURS = 3;
export const READY_HOURS = 2;
export const REMIND_HOURS = 6;
export const MAX_ATTEMPTS = 2;
export const MEM_FREE_MIN_PCT = 10;
const GRACE_MS = 60_000;

export type LoopOpts = { interval?: number; maxLanes?: number; maxStarts?: number; maxLoad?: number; force?: boolean };

// ---------- backlog ----------

function log(d: Deps, item: Item, kind: Item["log"][number]["kind"], text: string): void {
  const now = d.now();
  item.log.push({ at: now, kind, text });
  item.updatedAt = now;
  d.store.saveItem(item);
}

export function backlogAdd(
  d: Deps,
  id: string,
  briefFile: string,
  opts: { title?: string; priority?: number; cwd?: string; decision?: string; source?: string } = {},
): Item {
  if (!KEY_RE.test(id)) throw new Refusal(`item id must match ${KEY_RE} (it becomes the lane key)`);
  const priority = opts.priority ?? 5;
  if (!Number.isInteger(priority) || priority < 1 || priority > 9) throw new Refusal("--priority must be 1 (first) to 9 (last)");
  if (!existsSync(briefFile)) throw new Refusal(`no brief file ${briefFile}`);
  const old = d.store.item(id);
  if (old && (old.status === "open" || old.status === "running")) throw new Refusal(`item ${id} is already ${old.status}`);
  copyFileSync(briefFile, d.store.itemBrief(id));
  const now = d.now();
  const item: Item = {
    id, title: opts.title ?? id, brief: d.store.itemBrief(id), cwd: resolve(opts.cwd ?? process.cwd()), priority,
    status: "open", attempts: 0, createdAt: now, updatedAt: now, log: [],
    ...(opts.decision ? { decision: opts.decision } : {}),
    ...(opts.source ? { source: opts.source } : {}),
  };
  log(d, item, "add", opts.source ?? briefFile);
  return item;
}

function openItem(d: Deps, id: string): Item {
  const item = d.store.item(id);
  if (!item) throw new Refusal(`no backlog item ${id}`);
  if (item.status !== "open") throw new Refusal(`item ${id} is ${item.status}, not open`);
  return item;
}

/** Records the human's answer: clears the decision and appends the answer to the item's brief. */
export function backlogDecide(d: Deps, id: string, answer: string): void {
  if (!answer.trim()) throw new Refusal("decide needs the answer text");
  const item = openItem(d, id);
  appendFileSync(item.brief, `\n\nDecision on "${item.decision ?? "(none)"}": ${answer.trim()}\n`);
  delete item.decision;
  delete item.askedAt;
  delete item.remindedAt;
  item.attempts = 0;
  log(d, item, "decide", answer);
}

export function backlogDrop(d: Deps, id: string, why = "dropped"): void {
  const item = d.store.item(id);
  if (!item) throw new Refusal(`no backlog item ${id}`);
  if (item.status === "running") throw new Refusal(`item ${id} is running as a lane; close the lane first`);
  item.status = "dropped";
  log(d, item, "drop", why);
}

type Issue = { number: number; title: string; body: string; labels: { name: string }[] };

/** Open issues with a label become backlog items: label p1..p9 sets the priority, needs-decision marks a question. */
export async function backlogImport(d: Deps, repo: string, label = "dori", cwd?: string): Promise<string[]> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Refusal(`repo must look like owner/repo, got ${repo}`);
  const r = await d.exec("gh", ["issue", "list", "--repo", repo, "--label", label, "--state", "open", "--limit", "100", "--json", "number,title,body,labels"]);
  if (r.code !== 0) throw new Error(`gh issue list failed: ${(r.stderr || r.stdout).trim()}`);
  const known = new Set(d.store.items().map((i) => i.source));
  const added: string[] = [];
  for (const issue of JSON.parse(r.stdout) as Issue[]) {
    const source = `${repo}#${issue.number}`;
    if (known.has(source)) continue;
    const names = issue.labels.map((l) => l.name);
    const p = names.map((n) => /^p([1-9])$/.exec(n)?.[1]).find(Boolean);
    const id = `${repo.split("/")[1]!.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^[^a-z]+/, "")}-${issue.number}`.slice(0, 41);
    const brief = d.store.itemBrief(`${id}.import`);
    writeFileSync(brief, `# ${issue.title}\n\nSource: https://github.com/${repo}/issues/${issue.number}\n\n${issue.body}\n`);
    backlogAdd(d, id, brief, {
      title: issue.title, cwd, source,
      ...(p ? { priority: Number(p) } : {}),
      ...(names.includes("needs-decision") ? { decision: `issue ${source} is labelled needs-decision: ${issue.title}` } : {}),
    });
    rmSync(brief, { force: true });
    added.push(id);
  }
  return added;
}

// ---------- lock ----------

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Atomic create; a lock is taken over only when its process is dead. Returns the holder when someone else has it. */
function acquire(d: Deps): string | undefined {
  const path = d.store.loopPath("lock");
  for (let i = 0; i < 2; i++) {
    try {
      writeFileSync(path, JSON.stringify({ pid: process.pid, at: d.now() }), { flag: "wx" });
      return undefined;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const held = JSON.parse(readFileSync(path, "utf8") || "{}") as { pid?: number; at?: number };
      if (held.pid !== undefined && held.pid !== process.pid && alive(held.pid)) return `locked by pid ${held.pid}`;
      if (held.pid === process.pid) return `locked by this process`;
      rmSync(path, { force: true });
    }
  }
  return "lock contended";
}

// ---------- one run ----------

const PR_RE = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/;
const hours = (ms: number): number => Math.floor(ms / HOUR);

async function ghState(d: Deps, kind: "pr" | "issue", repo: string, n: string): Promise<string> {
  const r = await d.exec("gh", [kind, "view", n, "--repo", repo, "--json", "state"]);
  if (r.code !== 0) throw new Error(`gh ${kind} view ${repo}#${n}: ${(r.stderr || r.stdout).trim() || `exit ${r.code}`}`);
  return String((JSON.parse(r.stdout) as { state?: string }).state);
}

async function sync(d: Deps, run: LoopRun): Promise<void> {
  for (const item of d.store.items()) {
    try {
      if (item.status === "running") {
        const lane = d.store.lane(item.id);
        if (!lane || lane.status === "done") {
          item.status = "done";
          log(d, item, "done", lane ? "lane done" : "lane record missing");
          run.synced.push(`${item.id} done (${lane ? "lane done" : "lane record missing"})`);
        } else if (lane.status === "lost") {
          item.status = "open";
          item.attempts += 1;
          if (item.attempts >= MAX_ATTEMPTS) item.decision = `lane lost ${item.attempts} times; retry, re-brief or drop?`;
          log(d, item, "reopen", `lane lost, attempt ${item.attempts}`);
          run.synced.push(`${item.id} reopened (lane lost, attempt ${item.attempts})`);
        } else if (lane.status === "ready") {
          const m = lane.final?.evidence.map((e) => PR_RE.exec(e)).find(Boolean);
          if (m && (await ghState(d, "pr", m[1]!, m[2]!)) === "MERGED") {
            item.status = "done";
            log(d, item, "done", "PR merged");
            run.synced.push(`${item.id} done (PR merged)`);
            run.findings.push(`${item.id} READY and its PR merged: dori done ${item.id}`);
          }
        }
      } else if (item.status === "open" && item.source) {
        const [repo, n] = item.source.split("#");
        if ((await ghState(d, "issue", repo!, n!)) === "CLOSED") {
          item.status = "dropped";
          log(d, item, "drop", "source issue closed");
          run.synced.push(`${item.id} dropped (${item.source} closed)`);
        }
      }
    } catch (e) {
      run.findings.push(`gh: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

async function audit(d: Deps, run: LoopRun): Promise<void> {
  const now = d.now();
  for (const lane of d.store.lanes()) {
    if (lane.status !== "working" && lane.status !== "waiting" && lane.status !== "ready") continue;
    let st;
    try {
      st = await d.herdr.status(lane.paneId);
    } catch (e) {
      run.findings.push(`herdr: ${lane.key}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (st === "gone") {
      run.findings.push(`${lane.key} pane ${lane.paneId} is gone`);
    } else if (lane.status === "ready") {
      const age = now - (lane.final?.at ?? lane.lastActivityAt);
      if (age >= READY_HOURS * HOUR) run.findings.push(`${lane.key} READY ${hours(age)}h ago, not closed: dori done ${lane.key}`);
    } else if (st !== "working" && now - lane.lastActivityAt >= STALE_HOURS * HOUR) {
      const age = hours(now - lane.lastActivityAt);
      run.findings.push(lane.status === "waiting"
        ? `${lane.key} waiting ${age}h on: ${lane.log.at(-1)?.text.slice(0, 80) ?? "?"}`
        : `${lane.key} working, no report for ${age}h`);
    }
  }
}

const isOpenLane = (status: string): boolean => status !== "done" && status !== "lost";

async function pull(d: Deps, run: LoopRun, maxLanes: number, maxStarts: number, maxLoad?: number): Promise<void> {
  if (!d.store.roles().lead) {
    run.held.push("no lead pane registered");
    return;
  }
  const host = d.host();
  const open = d.store.lanes().filter((l) => isOpenLane(l.status)).length;
  let starts = Math.max(0, Math.min(maxLanes - open, maxStarts));
  const candidates = d.store.items()
    .filter((i) => i.status === "open" && !i.decision && !isOpenLane(d.store.lane(i.id)?.status ?? "done"))
    .sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  if (candidates.length > 0 && (host.load1 > (maxLoad ?? host.cores) || host.memFreePct < MEM_FREE_MIN_PCT)) {
    run.held.push(`host busy: load ${host.load1.toFixed(1)} (limit ${maxLoad ?? host.cores}), mem free ${host.memFreePct}%`);
    starts = 0;
  }
  let i = 0;
  for (; i < Math.min(starts, candidates.length); i++) {
    const item = candidates[i]!;
    try {
      await startLane(d, item.id, item.brief, { cwd: item.cwd });
    } catch (e) {
      item.attempts += 1;
      log(d, item, "start", `failed: ${e instanceof Error ? e.message : String(e)}`);
      run.findings.push(`start ${item.id} failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    item.status = "running";
    log(d, item, "start", "lane opened by the hourly loop");
    run.started.push(`${item.id} (p${item.priority})`);
  }
  const waiting = candidates.length - i;
  if (waiting > 0) {
    run.held.push(`${waiting} item(s) waiting: ${Math.max(0, maxLanes - open - i)} free of ${maxLanes} lanes, max ${maxStarts}/run`);
  }
}

function ask(d: Deps, run: LoopRun): void {
  const now = d.now();
  for (const item of d.store.items()) {
    if (item.status !== "open" || !item.decision) continue;
    const line = `[DECIDE ${item.id}] ${item.decision} -> dori backlog decide ${item.id} --text '...' | dori backlog drop ${item.id}`;
    if (item.askedAt === undefined) {
      item.askedAt = now;
      log(d, item, "ask", item.decision);
      run.asked.push(line);
    } else if (item.remindedAt === undefined && now - item.askedAt >= REMIND_HOURS * HOUR) {
      item.remindedAt = now;
      log(d, item, "remind", item.decision);
      run.asked.push(`(reminder) ${line}`);
    }
  }
}

export function summary(run: LoopRun): string {
  if (run.skipped) return `[LOOP ${new Date(run.at).toISOString().slice(0, 16)}Z] skipped: ${run.skipped}`;
  const s = run.status!;
  const lines = [
    `[LOOP ${new Date(run.at).toISOString().slice(0, 16)}Z] lanes ${s.lanes}/${s.maxLanes}${s.adhoc.length ? ` (not from backlog: ${s.adhoc.join(", ")})` : ""}` +
      ` | items open ${s.items.open} (decide ${s.items.decide}) running ${s.items.running}` +
      ` | load ${s.host.load1.toFixed(1)}/${s.host.cores} mem-free ${s.host.memFreePct}%`,
  ];
  for (const k of ["synced", "findings", "started", "held"] as const) if (run[k].length) lines.push(`${k}: ${run[k].join("; ")}`);
  lines.push(...run.asked);
  return lines.join("\n");
}

/** One hourly pass. Skipped runs (stopped, locked, too soon) change nothing and write nothing. */
export async function loopTick(d: Deps, opts: LoopOpts = {}): Promise<LoopRun> {
  const interval = opts.interval ?? HOUR;
  const maxLanes = opts.maxLanes ?? 3;
  const maxStarts = opts.maxStarts ?? 2;
  const empty = { synced: [], findings: [], started: [], held: [], asked: [] };
  const stop = d.store.stop();
  if (stop) return { at: d.now(), skipped: `stopped: ${stop.reason}`, ...empty };
  const holder = acquire(d);
  if (holder) return { at: d.now(), skipped: holder, ...empty };
  try {
    const last = d.store.lastRun();
    if (last && !opts.force && d.now() - last.at < interval - GRACE_MS) {
      return { at: d.now(), skipped: `ran ${Math.floor((d.now() - last.at) / 60_000)}m ago`, ...empty };
    }
    const run: LoopRun = { at: d.now(), synced: [], findings: [], started: [], held: [], asked: [] };
    await sync(d, run);
    await audit(d, run);
    await pull(d, run, maxLanes, maxStarts, opts.maxLoad);
    ask(d, run);
    const items = d.store.items();
    const running = new Set(items.filter((i) => i.status === "running").map((i) => i.id));
    const lanes = d.store.lanes().filter((l) => isOpenLane(l.status));
    run.status = {
      lanes: lanes.length,
      maxLanes,
      adhoc: lanes.filter((l) => !running.has(l.key)).map((l) => l.key),
      items: {
        open: items.filter((i) => i.status === "open").length,
        decide: items.filter((i) => i.status === "open" && i.decision).length,
        running: running.size,
      },
      host: d.host(),
    };
    d.store.saveRun(run);
    try {
      await tellLead(d, summary(run), "loop");
    } catch (e) {
      if (!(e instanceof Refusal)) throw e;
    }
    return run;
  } finally {
    rmSync(d.store.loopPath("lock"), { force: true });
  }
}

/** How long to sleep so runs stay on the hour of the last stamp, instead of drifting after a restart. */
export function msUntilNext(d: Deps, interval: number): number {
  const last = d.store.lastRun();
  return Math.max(1000, (last ? last.at + interval : d.now()) - d.now());
}
