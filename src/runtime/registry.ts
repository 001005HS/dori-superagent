import type { RuntimeKind, SessionRef, SessionRuntime } from "./types.ts";

/**
 * The runtimes one process talks to: `default` is the selected kind (where new sessions open), `for(ref)` is the
 * runtime that owns a stored session. Each kind is built on first use and then reused.
 */
export class Runtimes {
  private readonly built = new Map<RuntimeKind, SessionRuntime>();

  constructor(
    private readonly selected: RuntimeKind,
    private readonly make: (kind: RuntimeKind) => SessionRuntime,
  ) {}

  get default(): SessionRuntime {
    return this.of(this.selected);
  }

  for(ref: SessionRef): SessionRuntime {
    return this.of(ref.runtime);
  }

  private of(kind: RuntimeKind): SessionRuntime {
    let runtime = this.built.get(kind);
    if (runtime === undefined) {
      runtime = this.make(kind);
      this.built.set(kind, runtime);
    }
    return runtime;
  }
}
