const tails = new Map<string, Promise<unknown>>();

/** Serializes async operations sharing the same key (e.g. a draftId), so overlapping calls never interleave. */
export function runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  tails.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}
