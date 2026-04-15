import { useEffect, useRef, useState } from 'react';

const KEY_PREFIX = 'ace-trading:';

export function useLocalStorage<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const storageKey = KEY_PREFIX + key;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw == null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });

  // Debounce writes so dragging an input doesn't spam storage
  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* quota */ }
    }, 150);
    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
  }, [storageKey, value]);

  return [value, setValue];
}
