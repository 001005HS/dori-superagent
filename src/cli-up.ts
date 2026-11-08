import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promptsDir, type Deps } from "./harness.ts";
import { shq } from "./herdr.ts";

function renderPrompt(d: Deps, name: string): string {
  const dir = join(d.store.root, "prompts");
  mkdirSync(dir, { recursive: true });
  const src = readFileSync(join(promptsDir(), name), "utf8").replaceAll("{{dori}}", d.doriCmd);
  const out = join(dir, name);
  writeFileSync(out, src);
  return out;
}

export async function up(d: Deps, cwd: string): Promise<void> {
  const env = { DORI_HOME: d.store.root };
  const lead = await d.herdr.createWorkspace("dori", cwd);
  await d.herdr.run(lead.paneId, `${d.agentCmd} --append-system-prompt ${shq(renderPrompt(d, "lead.md"))}`);
  d.store.setRole("lead", lead.paneId);
  const duty = await d.herdr.createTab("duty", cwd, lead.workspaceId, env);
  await d.herdr.run(duty.paneId, `${d.agentCmd} --append-system-prompt ${shq(renderPrompt(d, "duty.md"))}`);
  d.store.setRole("duty", duty.paneId);
  const loop = await d.herdr.split(duty.paneId, cwd, env);
  await d.herdr.run(loop.paneId, `${d.doriCmd} duty --interval 60`);
  const hourly = await d.herdr.split(loop.paneId, cwd, { ...env, HERDR_WORKSPACE_ID: lead.workspaceId });
  await d.herdr.run(hourly.paneId, `${d.doriCmd} loop`);
  console.log(
    `UP lead=${lead.paneId} duty=${duty.paneId} loop=${loop.paneId} hourly=${hourly.paneId} home=${d.store.root}`,
  );
}

export function status(d: Deps): void {
  const roles = d.store.roles();
  console.log(`lead=${roles.lead ?? "-"} duty=${roles.duty ?? "-"} home=${d.store.root}`);
  for (const l of d.store.lanes()) {
    const last = l.log.at(-1);
    const age = Math.round((d.now() - l.lastActivityAt) / 60_000);
    console.log(
      `${l.key.padEnd(24)} ${l.status.padEnd(8)} ${l.paneId.padEnd(8)} active ${age}m ago  ${last ? `${last.kind}: ${last.text.slice(0, 60)}` : ""}`,
    );
  }
}
