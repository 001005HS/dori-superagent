import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { arch, platform, release } from "node:os";
import { join } from "node:path";

// Anonymous usage counts, sent the way omo sends its own: OTLP/HTTP JSON logs to the omo collector.
// Only counts and fixed enums leave the machine: never paths, repo names, PR numbers, lane keys or message text.
// Off with DORI_TELEMETRY=0 or DO_NOT_TRACK=1.

export const VERSION = "0.1.0";
const SCHEMA_VERSION = 1;
const HOUR_MS = 3_600_000;

export type MergeOutcome = "merged" | "no_receipt" | "review_block" | "no_checks" | "checks_red" | "checks_all_skipped";
export type DutyCounts = { ticks: number; flushed: number; nudges: number; escalations: number; lost: number };

export type TelemetryEvent =
  | { name: "dori.installed" }
  | { name: "dori.daily_active"; day_utc: string }
  | { name: "dori.lane_started"; open_lanes: number }
  | { name: "dori.lane_ready"; evidence_count: number; lane_minutes: number }
  | { name: "dori.merge_decided"; outcome: MergeOutcome }
  | { name: "dori.review_completed"; verdict: "CLEAR" | "BLOCK" }
  | ({ name: "dori.duty_summary" } & DutyCounts);

export type Sender = (url: string, body: string, headers: Record<string, string>) => Promise<void>;

export interface Usage {
  touch(): Promise<void>;
  record(event: TelemetryEvent): Promise<void>;
  duty(counts: DutyCounts): Promise<void>;
}

export const NOTICE = "dori sends anonymous usage counts (no paths, names or text). Turn it off with DORI_TELEMETRY=0.";

const isOff = (v: string | undefined) => v !== undefined && ["0", "false", "no", "off"].includes(v.trim().toLowerCase());
const isOn = (v: string | undefined) => v !== undefined && ["1", "true", "yes"].includes(v.trim().toLowerCase());

export const telemetryEnabled = (env: NodeJS.ProcessEnv): boolean => !isOff(env["DORI_TELEMETRY"]) && !isOn(env["DO_NOT_TRACK"]);

// Public client key for the dori-superagent product, the same kind omo ships in its client.
export const INGEST_KEY = "";

type State = {
  installId: string;
  noticeShown?: boolean;
  lastActiveDay?: string;
  duty?: DutyCounts & { since: number };
};

const fetchSender: Sender = async (url, body, headers) => {
  await fetch(url, { method: "POST", body, headers, signal: AbortSignal.timeout(2000) });
};

export class Telemetry implements Usage {
  constructor(
    private readonly home: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly send: Sender = fetchSender,
    private readonly now: () => number = Date.now,
    private readonly notice: (s: string) => void = (s) => process.stderr.write(s + "\n"),
  ) {}

  private get path(): string {
    return join(this.home, "telemetry.json");
  }

  private load(): { state: State; fresh: boolean } {
    if (existsSync(this.path)) return { state: JSON.parse(readFileSync(this.path, "utf8")) as State, fresh: false };
    return { state: { installId: randomBytes(16).toString("hex") }, fresh: true };
  }

  private save(state: State): void {
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(state) + "\n");
    renameSync(tmp, this.path);
  }

  async touch(): Promise<void> {
    if (!telemetryEnabled(this.env)) return;
    const { state, fresh } = this.load();
    const events: TelemetryEvent[] = fresh ? [{ name: "dori.installed" }] : [];
    if (!state.noticeShown) {
      this.notice(NOTICE);
      state.noticeShown = true;
    }
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (state.lastActiveDay !== day) {
      events.push({ name: "dori.daily_active", day_utc: day });
      state.lastActiveDay = day;
    }
    this.save(state);
    await this.emit(state.installId, events);
  }

  async record(event: TelemetryEvent): Promise<void> {
    if (!telemetryEnabled(this.env)) return;
    const { state, fresh } = this.load();
    if (fresh) this.save(state);
    await this.emit(state.installId, [event]);
  }

  async duty(counts: DutyCounts): Promise<void> {
    if (!telemetryEnabled(this.env)) return;
    const { state } = this.load();
    const now = this.now();
    const acc = state.duty ?? { ticks: 0, flushed: 0, nudges: 0, escalations: 0, lost: 0, since: now };
    for (const k of ["ticks", "flushed", "nudges", "escalations", "lost"] as const) acc[k] += counts[k];
    if (now - acc.since < HOUR_MS) {
      state.duty = acc;
      this.save(state);
      return;
    }
    const { since: _since, ...totals } = acc;
    state.duty = undefined;
    this.save(state);
    await this.emit(state.installId, [{ name: "dori.duty_summary", ...totals }]);
  }

  private async emit(installId: string, events: TelemetryEvent[]): Promise<void> {
    const key = this.env["DORI_TELEMETRY_KEY"] ?? INGEST_KEY;
    if (events.length === 0 || key === "") return;
    const endpoint = (this.env["DORI_TELEMETRY_ENDPOINT"] ?? "https://t.omo.dev").replace(/\/+$/, "");
    const body = JSON.stringify(otlpLogs(installId, events, this.now(), this.env));
    try {
      await this.send(`${endpoint}/v1/logs`, body, { "content-type": "application/json", "x-omo-ingest-key": key });
    } catch {
      // best effort by design: a failed or slow send never changes what the command does
    }
  }
}

export const noUsage: Usage = { touch: async () => {}, record: async () => {}, duty: async () => {} };

type AnyValue = { stringValue: string } | { intValue: string } | { boolValue: boolean };
const value = (v: string | number | boolean): AnyValue =>
  typeof v === "string" ? { stringValue: v } : typeof v === "boolean" ? { boolValue: v } : { intValue: String(Math.trunc(v)) };
const attr = (key: string, v: string | number | boolean) => ({ key, value: value(v) });

export function otlpLogs(installId: string, events: readonly TelemetryEvent[], nowMs: number, env: NodeJS.ProcessEnv) {
  const timeUnixNano = (BigInt(nowMs) * 1_000_000n).toString();
  const os = platform();
  return {
    resourceLogs: [
      {
        resource: {
          attributes: [
            attr("service.name", "dori-superagent"),
            attr("service.version", VERSION),
            attr("dori.install.hash", createHash("sha256").update(installId).digest("hex")),
            attr("dori.schema.version", SCHEMA_VERSION),
            attr("dori.ci", isOn(env["CI"]) || env["CI"] === "true"),
            attr("os.type", os === "win32" ? "windows" : os),
            attr("os.version", release().match(/^\d+(?:\.\d+){1,3}/)?.[0] ?? "0.0"),
            attr("host.arch", ({ x64: "amd64", arm64: "arm64" } as Record<string, string>)[arch()] ?? "other"),
          ],
        },
        scopeLogs: [
          {
            scope: { name: "dori-superagent", version: VERSION },
            logRecords: events.map(({ name, ...fields }) => ({
              timeUnixNano,
              eventName: name,
              body: { stringValue: name },
              attributes: [
                attr("log.record.uid", randomUUID()),
                ...Object.entries(fields).map(([k, v]) => attr(`dori.${k}`, v as string | number)),
              ],
            })),
          },
        ],
      },
    ],
  };
}
