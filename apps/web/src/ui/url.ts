// Keeps the page address equal to the displayed scene (FR-153): replaces the current history entry,
// never adds one and never reloads. While a frozen `transition` is shown (FR-191) its text is kept as written
// (FR-193); the caller passes none after a round change or when the parameter was invalid (FR-192, FR-194).
import { formatAddress } from '../core/address';
import type { Camera } from '../core/camera';

export function syncAddress(seed: number, round: number, camera: Camera, transition?: string): void {
  history.replaceState(null, '', formatAddress(seed, round, camera, transition));
}
