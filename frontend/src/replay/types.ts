export type ReplayStatus = 'idle' | 'paused' | 'playing' | 'ended';

export type ReplaySpeed = 1 | 2 | 4 | 8;

export interface ReplayState {
  enabled: boolean;
  status: ReplayStatus;
  anchorTs: number | null;
  cursorIndex: number;
  speed: ReplaySpeed;
  warmupBars: number;
  forwardPreloadBars: number;
}
