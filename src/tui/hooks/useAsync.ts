import { useEffect, useState } from 'react';

export type AsyncState<T> = Readonly<{
  loading: boolean;
  error: Error | null;
  value: T | null;
}>;

/**
 * Run an async function and track loading / error / value. Re-runs whenever any
 * value in `deps` changes (pass `refreshNonce` to wire it to manual refresh).
 * Stale results are dropped if deps change before the promise resolves.
 */
export const useAsync = <T>(fn: () => Promise<T>, deps: ReadonlyArray<unknown>): AsyncState<T> => {
  const [state, setState] = useState<AsyncState<T>>({ loading: true, error: null, value: null });

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ loading: true, error: null, value: prev.value }));
    fn().then(
      (value) => {
        if (!cancelled) setState({ loading: false, error: null, value });
      },
      (err: unknown) => {
        if (!cancelled) {
          setState({ loading: false, error: err instanceof Error ? err : new Error(String(err)), value: null });
        }
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
};
