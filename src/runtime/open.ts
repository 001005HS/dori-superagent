import type { CreateSpec, SessionRef, SessionRuntime } from "./types.ts";

/** create + start in one call (the root harness path). */
export const openSession = async (rt: SessionRuntime, spec: CreateSpec, command: string): Promise<SessionRef> => {
  const ref = await rt.create(spec);
  await rt.start(ref, command);
  return ref;
};
