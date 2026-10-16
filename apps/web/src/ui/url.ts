// Keeps the page address equal to the displayed scene (FR-153): replaces the current history entry,
// never adds one and never reloads.
import { formatAddress } from '../core/address';
import type { Camera } from '../core/camera';

export function syncAddress(seed: number, round: number, camera: Camera): void {
  history.replaceState(null, '', formatAddress(seed, round, camera));
}
