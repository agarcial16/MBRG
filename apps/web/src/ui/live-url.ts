// Keeps the address of the live scene equal to the displayed scene (D31): replaces the current history entry, never adds
// one and never reloads. The address holds the match id, the displayed round (at most N) and the camera, nothing else.
import { formatLiveAddress } from '../core/live-address';
import type { Camera } from '../core/camera';

export interface HistoryLike {
  replaceState(data: unknown, unused: string, url?: string | null): void;
}

export function syncLiveAddress(matchId: string, round: number, camera: Camera, history: HistoryLike = globalThis.history): void {
  history.replaceState(null, '', formatLiveAddress(matchId, round, camera));
}
