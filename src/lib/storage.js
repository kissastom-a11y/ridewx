/** Tiny localStorage helpers + a React hook. Storage can throw (private mode) – never crash on it. */
import { useCallback, useState } from 'react';

export function readJSON(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

/** useState that persists to localStorage. */
export function useStoredState(key, initial) {
  const [value, setValue] = useState(() => readJSON(key, initial));
  const set = useCallback((next) => {
    setValue((prev) => {
      const v = typeof next === 'function' ? next(prev) : next;
      writeJSON(key, v);
      return v;
    });
  }, [key]);
  return [value, set];
}
