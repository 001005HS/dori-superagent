#!/usr/bin/env bun
import { resolve } from "node:path";
import { runBacklog, runDuty, runLoop } from "./cli-loops.ts";
import { status, up } from "./cli-up.ts";
import { done, ready, report, startLane } from "./lanes.ts";
import { mergeGate, review } from "./gate.ts";
import { defaultDeps, Refusal, send, ROLES, type Deps, type SendResult } from "./harness.ts";
import { ConfigError, hooksSettled } from "./hooks.ts";
import { inboxList, releaseHeld, sendToShell } from "./inbox.ts";
import { refText } from "./refs.ts";
import { ConfigError as RuntimeConfigError, RuntimeChoiceError } from "./runtime/select.ts";
import { parseRef } from "./runtime/types.ts";
import type { Role } from "./store-types.ts";

export const USAGE = `dori - a proactive multi-session harness on herdr or hc + omo

  dori up [--cwd DIR]                         open lead, duty, duty loop and hourly loop sessions
  dori role <lead|duty> [REF]                 register a session (w1:p3, herdr:w1:p3, hc:t7) as lead or duty (default: this one)
  dori start <key> --brief FILE [--cwd DIR]   open a lane: new tab, omo session, brief + lane rules
  dori report <key> --text T [--status working|waiting]
  dori ready <key> --text T --evidence LINK [--evidence LINK ...]
  dori send <lead|duty|key|pane> --text T     deliver now, or queue until the pane's agent is idle
                  [--to-shell]                operator only: type this one message into a pane with no agent
  dori inbox list <pane|role|key>             queued entries: index, state (queued|typed|held), sender, time, first 60 chars
  dori inbox ack <pane|role|key> <index>      drop a held entry: it did reach the pane
  dori inbox resend <pane|role|key> <index>   release a held entry: the next flush delivers it
  dori duty [--once] [--interval SECONDS]     flush inboxes, nudge idle lanes, escalate, detect lost lanes
  dori duty stop [--text WHY] | resume | status   kill switch
  dori loop [--once] [--interval S] [--max-lanes N] [--max-starts N] [--max-load L] [--force]
                                              hourly: sync backlog, audit missed work, start the next item, ask decisions
  dori loop stop [--text WHY] | resume | status   kill switch and last run
  dori backlog add <id> --brief FILE [--title T] [--priority 1-9] [--cwd DIR] [--decision Q]
  dori backlog list | decide <id> --text ANSWER | drop <id> [--text WHY]
  dori backlog import <owner/repo> [--label dori] [--cwd DIR]   open labelled issues -> items
  dori review <owner/repo#N> [--model M]      fresh omo reviewer at the exact head -> receipt
  dori merge <owner/repo#N> [--dry-run]       CLEAR receipt at head + green checks -> squash merge
  dori done <key>                             lead closes a READY lane
  dori status

--text may be omitted to read the message from stdin.
send, report and ready exit 3 and print HELD <target> when the delivery may or may not have reached the pane:
it is held and never resent, so do not send it again: check the pane, then dori inbox ack or dori inbox resend it.
QUEUED (exit 0) means it waits in the pane's inbox.`;

const COMMANDS = new Set([
  "up",
  "role",
  "start",
  "report",
  "ready",
  "send",
  "inbox",
  "duty",
  "review",
  "merge",
  "done",
  "status",
  "loop",
  "backlog",
]);

export type Args = { pos: string[]; flags: Map<string, string[]> };

// Flags that never take a value. Every other flag takes the next argument verbatim, even one starting with "--", so a
// relayed value such as `--from "$SENDER"` or `--text "$MSG"` can never turn into a flag like --to-shell (#66).
const BOOLEAN_FLAGS: ReadonlySet<string> = new Set(["once", "force", "dry-run", "to-shell"]);

function parse(argv: readonly string[]): Args {
  const pos: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) {
      pos.push(a);
      continue;
    }
    const name = a.slice(2);
    const next = argv[i + 1];
    const value = BOOLEAN_FLAGS.has(name) || next === undefined ? "true" : (i++, next);
    flags.set(name, [...(flags.get(name) ?? []), value]);
  }
  return { pos, flags };
}

export const one = (a: Args, f: string): string | undefined => a.flags.get(f)?.at(-1);
export const need = (v: string | undefined, what: string): string => {
  if (!v) throw new Refusal(`missing ${what}\n\n${USAGE}`);
  return v;
};

export async function textOf(a: Args): Promise<string> {
  const t = one(a, "text");
  if (t !== undefined) return t;
  if (process.stdin.isTTY) throw new Refusal("give --text or pipe the message on stdin");
  return (await Bun.stdin.text()).trim();
}

/** Prints the line for a delivery that did not land now and returns the exit code: HELD 3, everything else 0. */
function deliveryOutcome(result: SendResult | undefined, target: string): number {
  if (result === "HELD") {
    console.log(`HELD ${target}: delivery may or may not have reached the pane; do not resend`);
    return 3;
  }
  if (result === "QUEUED") console.log(`QUEUED ${target}`);
  return 0;
}

export async function main(argv: readonly string[], d: Deps = defaultDeps()): Promise<number> {
  const a = parse(argv);
  const [cmd, x] = a.pos;
  if (cmd !== undefined && COMMANDS.has(cmd)) d.usage.touch();
  switch (cmd) {
    case "up":
      await up(d, resolve(one(a, "cwd") ?? process.cwd()));
      return 0;
    case "role": {
      const role = need(x, "role") as Role;
      if (!ROLES.includes(role)) throw new Refusal(`role must be one of ${ROLES.join(", ")}`);
      const given = a.pos[2];
      const ref = given === undefined ? d.runtimes.selfAny(process.env) : parseRef(given);
      if (given !== undefined && ref === undefined)
        throw new Refusal(`${given} is not a session ref (w1:p3, herdr:w1:p3 or hc:t7)`);
      if (ref === undefined) throw new Refusal(`missing session ref (not inside herdr or hc?)\n\n${USAGE}`);
      d.store.setRole(role, ref);
      console.log(`ROLE ${role}=${refText(ref)}`);
      return 0;
    }
    case "start": {
      const cwd = one(a, "cwd");
      const workspace = one(a, "workspace");
      const lane = await startLane(d, need(x, "lane key"), need(one(a, "brief"), "--brief"), {
        ...(cwd !== undefined ? { cwd } : {}),
        ...(workspace !== undefined ? { group: workspace } : {}),
      });
      console.log(`STARTED ${lane.key} pane=${refText(lane.sessionRef)} brief=${lane.brief}`);
      return 0;
    }
    case "report": {
      const st = one(a, "status");
      if (st && st !== "working" && st !== "waiting") throw new Refusal("--status must be working or waiting");
      const sent = await report(d, need(x, "lane key"), await textOf(a), st as "working" | "waiting" | undefined);
      console.log(`REPORTED ${x}`);
      return deliveryOutcome(sent, "lead");
    }
    case "ready": {
      const sent = await ready(d, need(x, "lane key"), await textOf(a), a.flags.get("evidence") ?? []);
      console.log(`READY ${x}`);
      return deliveryOutcome(sent, "lead");
    }
    case "send": {
      const target = need(x, "target");
      const deliver = one(a, "to-shell") === "true" ? sendToShell : send;
      const sent = await deliver(d, target, await textOf(a), one(a, "from") ?? process.env["DORI_LANE"] ?? "cli");
      if (sent === "DELIVERED") console.log(`DELIVERED ${target}`);
      return deliveryOutcome(sent, target);
    }
    case "inbox": {
      const target = need(a.pos[2], "target");
      if (x === "list") {
        const { paneId, entries } = inboxList(d, target);
        if (entries.length === 0) console.log(`EMPTY ${paneId}`);
        for (const e of entries)
          console.log(`${e.index} ${e.state} from ${e.from} queued ${new Date(e.at).toISOString()} ${e.preview}`);
        return 0;
      }
      if (x === "ack" || x === "resend") {
        const index = Number(need(a.pos[3], "entry index (see dori inbox list)"));
        const paneId = releaseHeld(d, target, index, x);
        console.log(
          x === "ack" ? `ACKED ${paneId} ${index}` : `RELEASED ${paneId} ${index}: the next flush delivers it`,
        );
        return 0;
      }
      throw new Refusal(`unknown inbox command ${x}\n\n${USAGE}`);
    }
    case "duty":
      return runDuty(d, a, x);
    case "loop":
      return runLoop(d, a, x);
    case "backlog":
      return runBacklog(d, a, x);
    case "review": {
      const r = await review(d, need(x, "PR"), one(a, "model"));
      console.log(`REVIEW ${x} head=${r.sha} verdict=${r.verdict}`);
      return r.verdict === "CLEAR" ? 0 : 1;
    }
    case "merge":
      console.log(await mergeGate(d, need(x, "PR"), { dryRun: one(a, "dry-run") === "true" }));
      return 0;
    case "done":
      await done(d, need(x, "lane key"));
      console.log(`DONE ${x}`);
      return 0;
    case "status":
      status(d);
      return 0;
    default:
      console.log(USAGE);
      return cmd === undefined || cmd === "help" || cmd === "--help" ? 0 : 64;
  }
}

if (import.meta.main) {
  const deps = defaultDeps();
  let code = 0;
  try {
    code = await main(process.argv.slice(2), deps);
  } catch (e) {
    if (
      !(
        e instanceof Refusal ||
        e instanceof ConfigError ||
        e instanceof RuntimeConfigError ||
        e instanceof RuntimeChoiceError
      )
    )
      throw e;
    console.error(e.message);
    code = 2;
  } finally {
    await hooksSettled();
    await deps.usage.flush(2000);
  }
  process.exit(code);
}
