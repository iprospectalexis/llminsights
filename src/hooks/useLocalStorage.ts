import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Generic JSON-persisted state hook.
 *
 * Reads `localStorage[key]` lazily on mount, falling back to
 * `initialValue` if the slot is empty / unparseable / running in a
 * non-browser environment. Writes back on every state change.
 *
 * - The `key` may change at runtime (e.g. per-project namespacing
 *   when the user navigates to a different project). On change the
 *   hook re-reads from the new slot.
 * - Errors during read or write are swallowed silently — localStorage
 *   can throw on quota-exceeded, privacy mode, etc., and a missing
 *   persistence is far better than a crashed dashboard.
 * - `setValue` accepts either a new value or an updater fn, matching
 *   the React `useState` API so consumers can drop-in replace it.
 *
 * NOT suitable for: cross-tab sync (would need a 'storage' event
 * listener — out of scope for the current dashboard-filters work).
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const readKey = useCallback(
    (k: string): T => {
      if (typeof window === 'undefined') return initialValue;
      try {
        const raw = window.localStorage.getItem(k);
        if (raw === null) return initialValue;
        return JSON.parse(raw) as T;
      } catch {
        return initialValue;
      }
    },
    // We intentionally do NOT depend on `initialValue` — for object
    // defaults the parent would have to memoize them to avoid an
    // infinite re-read loop. Treat `initialValue` as a one-shot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [value, setValue] = useState<T>(() => readKey(key));

  // Track the current key so we can detect changes inside `setValue`.
  const keyRef = useRef(key);

  // When `key` changes (e.g. user navigates to a different project),
  // re-read the new slot. Avoids carrying the previous project's
  // filters into the new project's namespace.
  useEffect(() => {
    if (keyRef.current === key) return;
    keyRef.current = key;
    setValue(readKey(key));
  }, [key, readKey]);

  // Persist on every change. Skip the noop write on initial mount —
  // we already have the value from `readKey`.
  const firstWriteSkipped = useRef(false);
  useEffect(() => {
    if (!firstWriteSkipped.current) {
      firstWriteSkipped.current = true;
      return;
    }
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Quota / privacy mode — silently degrade to in-memory state.
    }
  }, [key, value]);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue(prev =>
        typeof next === 'function' ? (next as (p: T) => T)(prev) : next,
      );
    },
    [],
  );

  return [value, set];
}
