import type { Result } from '@mbrg/shared';
import type { CleanupError, CleanupResult, PieceEntry } from '../../src/core/pieces';

/**
 * FR-117, literal reference: the loop exactly as the spec words it, recomputing every piece after
 * each reassignment. Slow on purpose and independent of `pieces.ts` (it shares no code with it).
 * Test-only.
 */
export function cleanupDirect(
  width: number,
  input: Uint32Array,
  entries: readonly PieceEntry[],
  minPieceSize: number,
): Result<CleanupResult, CleanupError> {
  const pixels = Uint32Array.from(input);
  const reassigned: CleanupResult['reassigned'] = [];
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= width || y >= width ? -1 : pixels[y * width + x]!;

  for (;;) {
    // Recompute all pieces from scratch: 4-connected sets of one non-zero value.
    const seen = new Uint8Array(pixels.length);
    const pieces: { value: number; list: number[] }[] = [];
    for (let start = 0; start < pixels.length; start++) {
      if (seen[start] || pixels[start] === 0) continue;
      const value = pixels[start]!;
      const list: number[] = [];
      const stack = [start];
      seen[start] = 1;
      while (stack.length > 0) {
        const i = stack.pop()!;
        list.push(i);
        const x = i % width;
        const y = (i - x) / width;
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
          if (at(nx, ny) !== value) continue;
          const j = ny * width + nx;
          if (seen[j]) continue;
          seen[j] = 1;
          stack.push(j);
        }
      }
      list.sort((a, b) => a - b);
      pieces.push({ value, list });
    }

    // Contact count with every value: pairs of 4-adjacent pixels, one in the piece, one of that value.
    const contactOf = (list: number[]): Map<number, number> => {
      const inPiece = new Set(list);
      const contact = new Map<number, number>();
      for (const i of list) {
        const x = i % width;
        const y = (i - x) / width;
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
          const v = at(nx, ny);
          if (v <= 0 || inPiece.has(ny * width + nx)) continue;
          contact.set(v, (contact.get(v) ?? 0) + 1);
        }
      }
      return contact;
    };
    // FR-163: a sea piece that touches no other sea zone is never taken.
    const eligible = (piece: { value: number; list: number[] }): boolean => {
      const self = entries.find((e) => e.id === piece.value)!;
      if (self.kind !== 'sea') return true;
      const contact = contactOf(piece.list);
      return entries.some((e) => e.kind === 'sea' && e.id !== self.id && (contact.get(e.id) ?? 0) >= 1);
    };

    // The eligible piece with fewest pixels among those below S; ties: first pixel in row-major order.
    let chosen: { value: number; list: number[] } | undefined;
    for (const piece of pieces) {
      if (piece.list.length >= minPieceSize || !eligible(piece)) continue;
      if (
        chosen === undefined ||
        piece.list.length < chosen.list.length ||
        (piece.list.length === chosen.list.length && piece.list[0]! < chosen.list[0]!)
      ) {
        chosen = piece;
      }
    }
    if (chosen === undefined) return { ok: true, value: { pixels, reassigned } };
    const contact = contactOf(chosen.list);

    const self = entries.find((e) => e.id === chosen.value)!;
    const best = (accept: (e: PieceEntry) => boolean): number | undefined => {
      let result: number | undefined;
      for (const e of entries) {
        if (e.id === self.id || !accept(e) || (contact.get(e.id) ?? 0) < 1) continue;
        if (result === undefined || contact.get(e.id)! > contact.get(result)!) result = e.id;
        // equal counts keep the earlier entry: entries are walked in map order
      }
      return result;
    };
    let target: number;
    if (self.kind === 'sea') {
      target = best((e) => e.kind === 'sea') ?? 0; // never 0: the piece is eligible only with sea contact
    } else {
      target =
        best((e) => e.kind === 'land' && e.owner === self.owner) ??
        best((e) => e.kind === 'land') ??
        best((e) => e.kind === 'sea') ??
        0;
    }

    // The entry would be left without a pixel: fail at the first such reassignment.
    let total = 0;
    for (const v of pixels) if (v === self.id) total++;
    if (total === chosen.list.length) {
      return { ok: false, errors: [{ kind: 'vanished-entry', territory: self.id }] };
    }
    for (const i of chosen.list) pixels[i] = target;
    reassigned.push({ entry: self.id, pixels: chosen.list.length, to: target });
  }
}
