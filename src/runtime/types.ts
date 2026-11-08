export type RuntimeKind = "herdr" | "hc";
export type SessionRef = { readonly runtime: RuntimeKind; readonly id: string; readonly group?: string };
export type AgentStatus = "idle" | "working" | "blocked" | "error" | "done" | "unknown" | "shell" | "gone";
export type AgentIdentity = { readonly agent?: string; readonly pgid?: number };
export type ForegroundProcess = { readonly name: string; readonly argv: readonly string[]; readonly pid?: number };
/** One snapshot: status, identity and foreground together (submitTyped compares all three; deliver re-reads them). */
export type Probe = { readonly status: AgentStatus; readonly agent?: string; readonly pgid?: number; readonly turn?: number; readonly shellInFront: boolean; readonly foreground?: readonly ForegroundProcess[] };
export type SessionRole = "lead" | "duty" | "duty-loop" | "hourly-loop" | "lane";
export type OpenSpec = { readonly name: string; readonly cwd: string; readonly command: string; readonly env: Readonly<Record<string, string>>; readonly role: SessionRole; readonly group?: string; readonly layout?: { readonly near: SessionRef; readonly how: "tab" | "below" } };
export type DeliverOutcome =
  | { readonly kind: "delivered"; readonly turn?: number; readonly started?: boolean }
  | { readonly kind: "no-agent" }
  | { readonly kind: "not-ready"; readonly status: AgentStatus }
  | { readonly kind: "typed"; readonly into: AgentIdentity; readonly failure: unknown }
  | { readonly kind: "ambiguous"; readonly detail: string; readonly failure: unknown };
export type SubmitResult = "submitted" | "wait" | "changed";
export type Key = "enter" | "escape";
export interface SessionRuntime {
  readonly kind: RuntimeKind;
  self(): SessionRef | undefined;
  open(spec: OpenSpec): Promise<SessionRef>;
  list(filter?: { readonly group?: string }): Promise<readonly SessionRef[]>;
  probe(ref: SessionRef): Promise<Probe>;
  read(ref: SessionRef, lines: number): Promise<string>;
  deliver(ref: SessionRef, text: string): Promise<DeliverOutcome>;
  submitTyped(ref: SessionRef, into: AgentIdentity): Promise<SubmitResult>;
  typeIntoShell(ref: SessionRef, text: string): Promise<boolean>;
  keys(ref: SessionRef, keys: readonly Key[]): Promise<void>;
  close(ref: SessionRef): Promise<void>;
}

/** Id shape of each kind: a pane `w<ws>:p<pane>` for the first, a terminal address `t<n>` for the second. */
const ID_SHAPES: Readonly<Record<RuntimeKind, RegExp>> = {
  herdr: /^w[0-9A-Za-z]+:p[0-9A-Za-z]+$/,
  hc: /^t[0-9]+$/,
};
const KINDS = Object.keys(ID_SHAPES) as RuntimeKind[];

const refOf = (runtime: RuntimeKind, id: string): SessionRef | undefined => (ID_SHAPES[runtime].test(id) ? { runtime, id } : undefined);

/** `"herdr:w1:p3"`, `"hc:t7"`, bare `"w1:p3"` (herdr), bare `"t7"` (hc); anything else is `undefined`. */
export const parseRef: (text: string) => SessionRef | undefined = (text) => {
  for (const kind of KINDS) {
    if (text.startsWith(`${kind}:`)) return refOf(kind, text.slice(kind.length + 1));
  }
  for (const kind of KINDS) {
    const ref = refOf(kind, text);
    if (ref) return ref;
  }
  return undefined;
};

/** The prefixed text form, `"herdr:w1:p3"` / `"hc:t7"`; the group is not part of it. */
export const formatRef: (ref: SessionRef) => string = (ref) => `${ref.runtime}:${ref.id}`;
