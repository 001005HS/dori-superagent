import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Telemetry, telemetryEnabled } from "../src/telemetry.ts";

type Sent = { url: string; body: string; headers: Record<string, string> };

function rig(env: Record<string, string> = { DORI_TELEMETRY_KEY: "test-key" }) {
  const home = mkdtempSync(join(tmpdir(), "dori-tel-"));
  const sent: Sent[] = [];
  const notices: string[] = [];
  let clock = Date.parse("2026-11-02T10:00:00Z");
  const t = new Telemetry(home, env, async (url, body, headers) => { sent.push({ url, body, headers }); }, () => clock, (s) => notices.push(s));
  const names = () => sent.flatMap((s) => JSON.parse(s.body).resourceLogs[0].scopeLogs[0].logRecords.map((r: { eventName: string }) => r.eventName));
  return { home, t, sent, notices, names, advance: (ms: number) => { clock += ms; } };
}

describe("telemetry", () => {
  test("DORI_TELEMETRY=0 and DO_NOT_TRACK=1 turn it off completely: nothing sent, nothing written", async () => {
    expect(telemetryEnabled({ DORI_TELEMETRY: "0" })).toBe(false);
    expect(telemetryEnabled({ DO_NOT_TRACK: "1" })).toBe(false);
    expect(telemetryEnabled({})).toBe(true);
    const r = rig({ DORI_TELEMETRY_KEY: "k", DORI_TELEMETRY: "0" });
    await r.t.touch();
    await r.t.record({ name: "dori.lane_started", open_lanes: 1 });
    expect(r.sent).toEqual([]);
    expect(r.notices).toEqual([]);
    expect(existsSync(join(r.home, "telemetry.json"))).toBe(false);
  });

  test("first run: one notice, installed + daily_active; later runs the same day send nothing; the next day sends daily_active again", async () => {
    const r = rig();
    await r.t.touch();
    expect(r.notices).toHaveLength(1);
    expect(r.names()).toEqual(["dori.installed", "dori.daily_active"]);
    await r.t.touch();
    expect(r.names()).toHaveLength(2);
    r.advance(24 * 3_600_000);
    await r.t.touch();
    expect(r.names()).toEqual(["dori.installed", "dori.daily_active", "dori.daily_active"]);
    expect(r.notices).toHaveLength(1);
    expect(r.sent[0]!.url).toBe("https://t.omo.dev/v1/logs");
    expect(r.sent[0]!.headers).toEqual({ "content-type": "application/json", "x-omo-ingest-key": "test-key" });
  });

  test("the payload is OTLP JSON with an install hash and counts only", async () => {
    const r = rig();
    await r.t.record({ name: "dori.lane_ready", evidence_count: 2, lane_minutes: 37 });
    const body = JSON.parse(r.sent[0]!.body);
    const resource = Object.fromEntries(body.resourceLogs[0].resource.attributes.map((a: { key: string; value: unknown }) => [a.key, a.value]));
    expect(resource["service.name"]).toEqual({ stringValue: "dori-superagent" });
    expect(resource["dori.install.hash"].stringValue).toMatch(/^[0-9a-f]{64}$/);
    const rec = body.resourceLogs[0].scopeLogs[0].logRecords[0];
    expect(rec.eventName).toBe("dori.lane_ready");
    expect(rec.timeUnixNano).toMatch(/^[0-9]+$/);
    const attrs = Object.fromEntries(rec.attributes.map((a: { key: string; value: unknown }) => [a.key, a.value]));
    expect(attrs["dori.evidence_count"]).toEqual({ intValue: "2" });
    expect(attrs["dori.lane_minutes"]).toEqual({ intValue: "37" });
    expect(r.sent[0]!.body).not.toContain(r.home);
  });

  test("duty ticks are summed and sent at most once an hour", async () => {
    const r = rig();
    const tick = { ticks: 1, flushed: 1, nudges: 0, escalations: 0, lost: 0 };
    for (let i = 0; i < 60; i++) { await r.t.duty(tick); r.advance(60_000); }
    expect(r.sent).toEqual([]);
    await r.t.duty({ ...tick, nudges: 1 });
    expect(r.names()).toEqual(["dori.duty_summary"]);
    const attrs = JSON.parse(r.sent[0]!.body).resourceLogs[0].scopeLogs[0].logRecords[0].attributes;
    const get = (k: string) => attrs.find((a: { key: string }) => a.key === k).value.intValue;
    expect([get("dori.ticks"), get("dori.flushed"), get("dori.nudges")]).toEqual(["61", "61", "1"]);
    await r.t.duty(tick);
    expect(r.sent).toHaveLength(1);
  });

  test("a failing or missing collector never throws, and no key means nothing is sent", async () => {
    const home = mkdtempSync(join(tmpdir(), "dori-tel-"));
    const failing = new Telemetry(home, { DORI_TELEMETRY_KEY: "k" }, async () => { throw new Error("offline"); }, Date.now, () => {});
    await failing.touch();
    let calls = 0;
    const keyless = new Telemetry(mkdtempSync(join(tmpdir(), "dori-tel-")), {}, async () => { calls++; }, Date.now, () => {});
    await keyless.touch();
    expect(calls).toBe(0);
  });
});
