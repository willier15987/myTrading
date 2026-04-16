import { useEffect, useRef } from 'react';
import { syncLive, type LiveSyncResponse } from '../api/live';

export type LiveSyncStatus = 'idle' | 'syncing' | 'ok' | 'error';

interface UseLiveSyncOptions {
  enabled: boolean;
  symbol: string | null;
  pollSec: number;
  replayEnabled: boolean;
  onSynced: (response: LiveSyncResponse) => void;
  onStatus: (status: LiveSyncStatus, error?: string) => void;
}

const ERROR_BACKOFF_MS = 5 * 60_000;
const ERROR_THRESHOLD = 3;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return '即時同步失敗';
}

export function useLiveSync({
  enabled,
  symbol,
  pollSec,
  replayEnabled,
  onSynced,
  onStatus,
}: UseLiveSyncOptions) {
  const onSyncedRef = useRef(onSynced);
  const onStatusRef = useRef(onStatus);
  const timeoutRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const failureCountRef = useRef(0);
  const stableStatusRef = useRef<LiveSyncStatus>('idle');

  useEffect(() => {
    onSyncedRef.current = onSynced;
  }, [onSynced]);

  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  useEffect(() => {
    const clearScheduled = () => {
      if (timeoutRef.current != null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };

    const clearActiveRequest = () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };

    if (!enabled || replayEnabled || !symbol) {
      clearScheduled();
      clearActiveRequest();
      failureCountRef.current = 0;
      stableStatusRef.current = 'idle';
      onStatusRef.current('idle');
      return;
    }

    let active = true;

    const scheduleNext = () => {
      clearScheduled();
      if (!active) return;

      const delay = failureCountRef.current >= ERROR_THRESHOLD
        ? ERROR_BACKOFF_MS
        : pollSec * 1000;

      timeoutRef.current = window.setTimeout(() => {
        void runSync();
      }, delay);
    };

    const runSync = async () => {
      if (!active) return;
      if (document.hidden) {
        stableStatusRef.current = 'idle';
        onStatusRef.current('idle');
        return;
      }

      clearActiveRequest();
      const controller = new AbortController();
      abortRef.current = controller;
      onStatusRef.current('syncing');

      try {
        const response = await syncLive(symbol, { signal: controller.signal });
        if (!active) return;

        failureCountRef.current = 0;
        stableStatusRef.current = 'ok';
        onSyncedRef.current(response);
        onStatusRef.current('ok');
      } catch (error) {
        if (!active || controller.signal.aborted) return;

        failureCountRef.current += 1;
        if (failureCountRef.current >= ERROR_THRESHOLD) {
          stableStatusRef.current = 'error';
          onStatusRef.current('error', getErrorMessage(error));
        } else {
          onStatusRef.current(stableStatusRef.current);
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        scheduleNext();
      }
    };

    const handleVisibilityChange = () => {
      if (!active) return;
      if (document.hidden) {
        clearScheduled();
        clearActiveRequest();
        stableStatusRef.current = 'idle';
        onStatusRef.current('idle');
        return;
      }
      void runSync();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    void runSync();

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearScheduled();
      clearActiveRequest();
    };
  }, [enabled, pollSec, replayEnabled, symbol]);
}
