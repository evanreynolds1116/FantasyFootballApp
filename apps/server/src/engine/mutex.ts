/** Creates a fresh, isolated key-based mutex — one per server instance, never a module-level singleton. */
export function createMutex() {
  const tails = new Map<string, Promise<unknown>>();

  return function runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
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
  };
}
