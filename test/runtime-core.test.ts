import { describe, expect, test } from "bun:test";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnExec, ToolError } from "../src/runtime/exec.ts";
import { interactiveShellInFront, SHELLS } from "../src/runtime/foreground.ts";
import { groupId } from "../src/runtime/group.ts";
import { Runtimes } from "../src/runtime/registry.ts";
import type { ForegroundProcess, RuntimeKind, SessionRef, SessionRuntime } from "../src/runtime/types.ts";
import { formatRef, parseRef } from "../src/runtime/types.ts";

describe("parseRef / formatRef", () => {
  test.each([
    ["herdr:w1:p3", { runtime: "herdr", id: "w1:p3" }],
    ["hc:t7", { runtime: "hc", id: "t7" }],
    ["w1:p3", { runtime: "herdr", id: "w1:p3" }],
    ["wAb:pX9", { runtime: "herdr", id: "wAb:pX9" }],
    ["t7", { runtime: "hc", id: "t7" }],
    ["t", undefined],
    ["", undefined],
    ["lead", undefined],
    ["tmux:w1:p3", undefined],
    ["herdr:t7", undefined],
    ["hc:w1:p3", undefined],
    ["hc:", undefined],
    ["w1:p3 ", undefined],
    ["machine/t7", undefined],
  ] as const)("parseRef(%p)", (text, want) => {
    expect(parseRef(text)).toEqual(want);
  });

  test.each([
    ["herdr:w1:p3", { runtime: "herdr", id: "w1:p3" }],
    ["hc:t7", { runtime: "hc", id: "t7" }],
    ["hc:t7 (group dropped)", { runtime: "hc", id: "t7", group: "abcd1234" }],
  ] as const)("formatRef gives %s and parses back", (want, ref) => {
    expect(formatRef(ref)).toBe(want.split(" ")[0] ?? "");
    expect(parseRef(formatRef(ref))).toEqual({ runtime: ref.runtime, id: ref.id });
  });
});

describe("interactiveShellInFront (#66), ported from the herdr parser", () => {
  const p = (name: string, ...argv: string[]): ForegroundProcess => ({ name, argv });
  test.each([
    ["login shell", [p("-bash", "-bash")], true],
    ["interactive zsh by path, upper case", [p("/bin/ZSH", "/bin/zsh", "-i")], true],
    ["bash -C (noclobber) is still interactive", [p("bash", "bash", "-C")], true],
    ["busybox sh applet", [p("busybox", "busybox", "sh")], true],
    ["shell entry without argv", [p("fish")], true],
    ["agent with a sh -c child", [p("omo", "omo"), p("sh", "sh", "-c", "sleep 1")], false],
    ["shell running a script is held, the safe side", [p("bash", "bash", "tool.sh")], true],
    ["interactive bash with --rcfile FILE", [p("bash", "bash", "--rcfile", "/tmp/rc")], true],
    ["interactive zsh with -o OPT", [p("zsh", "zsh", "-o", "vi")], true],
    ["login shell running a command: -lc", [p("bash", "bash", "-lc", "make")], false],
    ["pwsh -File", [p("pwsh", "pwsh", "-File", "x.ps1")], false],
    ["bash -f (noglob) is still interactive", [p("bash", "bash", "-f")], true],
    ["bash --init-file F", [p("bash", "bash", "--init-file", "/tmp/rc")], true],
    ["fish -C cmd (init command, still interactive)", [p("fish", "fish", "-C", "set x 1")], true],
    ["bash -ic cmd runs a command", [p("bash", "bash", "-ic", "make")], false],
    ["pwsh -EncodedCommand", [p("pwsh", "pwsh", "-EncodedCommand", "ZQBjAGgAbwA=")], false],
    ["pwsh -Interactive", [p("pwsh", "pwsh", "-Interactive")], true],
    ["pwsh -NoProfile -ExecutionPolicy Bypass", [p("pwsh", "pwsh", "-NoProfile", "-ExecutionPolicy", "Bypass")], true],
    ["pwsh -NoExit -Command keeps a prompt", [p("pwsh", "pwsh", "-NoExit", "-Command", "ls")], true],
    ["pwsh -noex -c keeps a prompt", [p("pwsh", "pwsh", "-noex", "-c", "ls")], true],
    ["pwsh --noexi -Command keeps a prompt", [p("pwsh", "pwsh", "--noexi", "-Command", "ls")], true],
    ["powershell -c", [p("powershell", "powershell", "-c", "ls")], false],
    ["pwsh -Command", [p("pwsh", "pwsh", "-Command", "ls")], false],
    ["exec'd agent", [p("bun", "bun", "omo.js")], false],
    ["busybox running a command applet: busybox sh -c", [p("busybox", "busybox", "sh", "-c", "x")], false],
    ["hc group leader only: an agent", [{ name: "omo", argv: ["omo"], pid: 4242 }], false],
    ["hc group leader only: a bare shell", [{ name: "bash", argv: ["bash"], pid: 4242 }], true],
  ] as const)("%s", (_, procs, want) => {
    expect(interactiveShellInFront(procs)).toBe(want);
  });

  test("an empty or missing process list is doubt", () => {
    expect(interactiveShellInFront([])).toBe(true);
    expect(interactiveShellInFront(undefined)).toBe(true);
  });

  test("SHELLS covers the busybox and PowerShell names", () => {
    for (const name of ["sh", "bash", "zsh", "fish", "busybox", "pwsh", "powershell"]) expect(SHELLS.has(name)).toBe(true);
    expect(SHELLS.has("omo")).toBe(false);
  });
});

describe("Runtimes registry", () => {
  const fakeRuntime = (kind: RuntimeKind): SessionRuntime => {
    const never = (): never => {
      throw new Error("not used");
    };
    return {
      kind,
      self: () => undefined,
      createGroup: never,
      create: never,
      start: never,
      list: never,
      probe: never,
      read: never,
      deliver: never,
      submitTyped: never,
      typeIntoShell: never,
      keys: never,
      close: never,
    };
  };
  const counting = () => {
    const made: RuntimeKind[] = [];
    const runtimes = new Runtimes("hc", (k) => {
      made.push(k);
      return fakeRuntime(k);
    });
    return { made, runtimes };
  };

  test("builds nothing until asked, then memoises one runtime per kind", () => {
    const { made, runtimes } = counting();
    expect(made).toEqual([]);
    const a = runtimes.default;
    const b = runtimes.default;
    expect(a).toBe(b);
    expect(a.kind).toBe("hc");
    expect(made).toEqual(["hc"]);
  });

  test("routes by the ref's runtime, not the selected one", () => {
    const { made, runtimes } = counting();
    const herdrRef: SessionRef = { runtime: "herdr", id: "w1:p3" };
    expect(runtimes.for(herdrRef).kind).toBe("herdr");
    expect(runtimes.for({ runtime: "hc", id: "t7" })).toBe(runtimes.default);
    expect(runtimes.for(herdrRef)).toBe(runtimes.for(herdrRef));
    expect(made).toEqual(["herdr", "hc"]);
  });
});

describe("groupId", () => {
  test("is 8 lowercase hex chars and stable for one store root", () => {
    const id = groupId("/some/dori/home");
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(groupId("/some/dori/home")).toBe(id);
  });

  test("hashes the resolved path: relative and trailing-slash spellings agree, other roots differ", () => {
    expect(groupId("/some/dori/home/")).toBe(groupId("/some/dori/home"));
    expect(groupId("/some/dori/./home")).toBe(groupId("/some/dori/home"));
    expect(groupId(".")).toBe(groupId(process.cwd()));
    expect(groupId("/other/home")).not.toBe(groupId("/some/dori/home"));
  });

  test("a symlinked store root shares the target's group", () => {
    const dir = mkdtempSync(join(tmpdir(), "dori-group-"));
    symlinkSync(dir, `${dir}-link`);
    expect(groupId(`${dir}-link`)).toBe(groupId(dir));
  });
});

describe("exec", () => {
  test("ToolError names the tool, argv, exit code and the tool's own reason", () => {
    const err = new ToolError(["get", "t7"], { code: 3, stdout: "out", stderr: " not found \n" }, "hc");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("hc get t7 failed (3): not found");
    expect(err.argv).toEqual(["get", "t7"]);
    expect(err.result.code).toBe(3);
    expect(new ToolError(["x"], { code: 1, stdout: "from stdout", stderr: "" }, "herdr").message).toBe("herdr x failed (1): from stdout");
  });

  test("spawnExec returns code, stdout and stderr of a real process", async () => {
    const r = await spawnExec("sh", ["-c", "printf out; printf err >&2; exit 4"]);
    expect(r).toEqual({ code: 4, stdout: "out", stderr: "err" });
  });
});
