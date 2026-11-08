import { readFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join, resolve } from "node:path";
import { DeliveryUncertain, Herdr, shq, spawnExec, type Exec } from "./herdr.ts";
import { memFreePct } from "./host.ts";
import { flushInbox } from "./inbox.ts";
import { Store } from "./store.ts";
import { KEY_RE, reservedKey, type HostLoad, type Role } from "./store-types.ts";
import { Telemetry, type Usage } from "./telemetry.ts";

export { KEY_RE, reservedKey };

const PROMPTS = join(import.meta.dir, "..", "prompts");
const CLI = resolve(import.meta.dir, "cli.ts");

export type Deps = {
  readonly store: Store;
  readonly herdr: Herdr;
  readonly exec: Exec;
  readonly now: () => number;
  readonly agentCmd: string;
  readonly doriCmd: string;
  readonly host: () => HostLoad;
  readonly usage: Usage;
};

export const defaultDeps = (): Deps => {
  const store = new Store();
  return {
    store,
    herdr: new Herdr(),
    exec: spawnExec,
    now: Date.now,
    agentCmd: process.env["DORI_AGENT_CMD"] ?? "omo",
    doriCmd: process.env["DORI_CMD"] ?? `DORI_HOME=${shq(store.root)} bun ${shq(CLI)}`,
    host: () => ({ load1: loadavg()[0] ?? 0, cores: cpus().length, memFreePct: memFreePct() }),
    usage: new Telemetry(store.root),
  };
};

export class Refusal extends Error {}

export const prompt = (name: string, vars: Record<string, string>): string =>
  readFileSync(join(PROMPTS, name), "utf8").replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? `{{${k}}}`);

export function resolveTarget(d: Deps, target: string): string {
  if (/^w[0-9A-Za-z]+:p[0-9A-Za-z]+$/.test(target)) return target;
  const roles = d.store.roles();
  if (target === "lead" || target === "duty") {
    const pane = roles[target];
    if (!pane) throw new Refusal(`no ${target} pane registered (dori role ${target} <pane>)`);
    return pane;
  }
  const lane = d.store.lane(target);
  if (lane && lane.status !== "done") return lane.paneId;
  throw new Refusal(`unknown target ${target}: not a pane id, role or open lane`);
}

export type SendResult = "DELIVERED" | "QUEUED" | "HELD";

/**
 * Delivers now when the pane can read; otherwise queues it for the duty loop (busy agents are never interrupted).
 * The command-line path: an uncertain delivery is a result, never an error (see settled).
 */
export async function send(d: Deps, target: string, text: string, from: string): Promise<SendResult> {
  return settled(sendOrThrow(d, target, text, from));
}

/** send for the duty and hourly loops: throws DeliveryUncertain, having recorded it, so they report the failure. */
export async function sendOrThrow(
  d: Deps,
  target: string,
  text: string,
  from: string,
): Promise<"DELIVERED" | "QUEUED"> {
  const paneId = resolveTarget(d, target);
  d.store.enqueue(paneId, { at: d.now(), from, text });
  return (await flushInbox(d, paneId)) === "delivered" ? "DELIVERED" : "QUEUED";
}

/**
 * An uncertain delivery is already recorded on the queued message (#89), so on the command-line path it is a result:
 * a sender who saw a failure would send again. `HELD`: it may or may not have reached the pane and is not resent.
 * `QUEUED`: typed text that only waits for its Enter.
 */
export async function settled<T extends SendResult | undefined>(delivery: Promise<T>): Promise<T | "QUEUED" | "HELD"> {
  try {
    return await delivery;
  } catch (e) {
    if (e instanceof DeliveryUncertain) return e.typed ? "QUEUED" : "HELD";
    throw e;
  }
}

/** The lead delivery's result, or undefined when no lead is registered. Throws DeliveryUncertain like sendOrThrow. */
export async function tellLead(d: Deps, text: string, from: string): Promise<"DELIVERED" | "QUEUED" | undefined> {
  if (!d.store.roles().lead) {
    process.stderr.write(`dori: no lead pane registered; message kept only in the lane log\n`);
    return undefined;
  }
  return sendOrThrow(d, "lead", text, from);
}

export const ROLES: readonly Role[] = ["lead", "duty"];
