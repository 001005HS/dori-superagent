import type { AgentIdentity } from "./runtime/types.ts";

/**
 * A delivery that failed after the message may already have reached the session (#89): sending it again could deliver
 * it twice. `typed`: the text is in the session's input and only the Enter that submits it is missing; `agent` is the
 * agent it was typed into (#108).
 */
export class DeliveryUncertain extends Error {
  constructor(
    readonly failure: unknown,
    readonly typed: boolean,
    readonly agent?: AgentIdentity,
  ) {
    super(failure instanceof Error ? failure.message : String(failure));
  }
}

/** One word for a POSIX shell: single-quoted, nothing in it expands. */
export const shq = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`;
