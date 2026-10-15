import { describe, expect, it } from 'vitest';
import { cleanupPieces, labelPieces, type PieceEntry } from '../src/core/pieces';
import { cleanupDirect } from './helpers/cleanup-direct';

/** '.' background (0), a digit = the id of that entry. Rows must make a square. */
function grid(rows: string[]): { width: number; pixels: Uint32Array } {
  const width = rows.length;
  const pixels = new Uint32Array(width * width);
  rows.forEach((row, y) => {
    expect(row.length).toBe(width);
    [...row].forEach((ch, x) => {
      pixels[y * width + x] = ch === '.' ? 0 : Number(ch);
    });
  });
  return { width, pixels };
}

function show(pixels: Uint32Array, width: number): string[] {
  const rows: string[] = [];
  for (let y = 0; y < width; y++) {
    let row = '';
    for (let x = 0; x < width; x++) row += pixels[y * width + x] === 0 ? '.' : String(pixels[y * width + x]);
    rows.push(row);
  }
  return rows;
}

const land = (id: number, owner: number): PieceEntry => ({ id, kind: 'land', owner });
const sea = (id: number): PieceEntry => ({ id, kind: 'sea' });

/** Runs the incremental and the literal loop; they must agree exactly (FR-117 identity). */
function run(rows: string[], entries: PieceEntry[], minPieceSize: number) {
  const { width, pixels } = grid(rows);
  const fast = cleanupPieces(width, pixels, entries, minPieceSize);
  const direct = cleanupDirect(width, pixels, entries, minPieceSize);
  expect(fast).toEqual(direct);
  return fast;
}

function okRows(rows: string[], entries: PieceEntry[], minPieceSize: number) {
  const result = run(rows, entries, minPieceSize);
  if (!result.ok) throw new Error('expected ok, got ' + JSON.stringify(result.errors));
  return { rows: show(result.value.pixels, rows.length), log: result.value.reassigned };
}

describe('labelPieces', () => {
  it('FR-117: pieces are 4-connected sets of one non-zero value, in row-major order of their first pixel', () => {
    const { width, pixels } = grid(['11.2', '.1.2', '2..1', '..11']);
    const { label, pieces } = labelPieces(width, pixels);
    expect(pieces).toEqual([
      { value: 1, size: 3, first: 0 },
      { value: 2, size: 2, first: 3 },
      { value: 2, size: 1, first: 8 },
      { value: 1, size: 3, first: 11 },
    ]);
    expect(label[2]).toBe(-1);
    expect(label[0]).toBe(label[1]);
    expect(label[0]).toBe(label[5]);
  });

  it('FR-117: a diagonal touch does not join pieces of the same value', () => {
    const { width, pixels } = grid(['1.', '.1']);
    expect(labelPieces(width, pixels).pieces.map((p) => p.size)).toEqual([1, 1]);
  });
});

describe('cleanupPieces', () => {
  it('FR-117: step 1, the same-faction land with contact wins even against a higher count of another faction', () => {
    const out = okRows(
      ['222222', '222222', '223111', '222111', '222111', '333111'],
      [land(1, 10), land(2, 20), land(3, 10)],
      3,
    );
    expect(out.rows[2]).toBe('221111');
    expect(out.log).toEqual([{ entry: 3, pixels: 1, to: 1 }]);
  });

  it('FR-117: step 2, with no same-faction contact the land of any faction with the highest count wins', () => {
    const out = okRows(
      ['222222', '222222', '223111', '222111', '222111', '333111'],
      [land(1, 20), land(2, 20), land(3, 10)],
      3,
    );
    expect(out.rows[2]).toBe('222111');
    expect(out.log).toEqual([{ entry: 3, pixels: 1, to: 2 }]);
  });

  it('FR-117: step 3, a land piece touching only sea goes to the sea zone with the highest count', () => {
    const out = okRows(
      ['777888', '773888', '777888', '111111', '777111', '333111'],
      [land(1, 10), land(3, 10), sea(7), sea(8)],
      3,
    );
    expect(out.rows[1]).toBe('777888');
    expect(out.log).toEqual([{ entry: 3, pixels: 1, to: 7 }]);
  });

  it('FR-117: step 4, a piece with only background contact (corners are no contact) becomes background', () => {
    const out = okRows(
      ['......', '.3....', '..1111', '331111', '331111', '331111'],
      [land(1, 10), land(3, 10)],
      3,
    );
    expect(out.rows[1]).toBe('......');
    expect(out.log).toEqual([{ entry: 3, pixels: 1, to: 0 }]);
  });

  it('FR-117: step 1 is skipped for a same-faction land touching only by a corner; step 2 takes the other', () => {
    const out = okRows(
      ['......', '.3222.', '..1111', '331111', '331111', '331111'],
      [land(1, 10), land(2, 20), land(3, 10)],
      3,
    );
    expect(out.rows[1]).toBe('.2222.');
    expect(out.log[0]).toEqual({ entry: 3, pixels: 1, to: 2 });
  });

  it('FR-117: a sea piece goes to the other sea zone with the highest count, never to land', () => {
    const out = okRows(
      ['888888', '888888', '887111', '888111', '777111', '777111'],
      [land(1, 10), sea(7), sea(8)],
      3,
    );
    expect(out.rows[2]).toBe('888111');
    expect(out.log).toEqual([{ entry: 7, pixels: 1, to: 8 }]);
  });

  it('FR-117: a sea piece touching only land and background becomes background', () => {
    const out = okRows(
      ['111111', '111111', '117111', '111111', '777111', '777111'],
      [land(1, 10), sea(7)],
      3,
    );
    expect(out.rows[2]).toBe('11.111');
    expect(out.log).toEqual([{ entry: 7, pixels: 1, to: 0 }]);
  });

  it('FR-117: contact counts pairs of 4-adjacent pixels, so one pixel touching two pixels counts twice', () => {
    const out = okRows(
      ['554444', '533333', '.33333', '......', '......', '5555..'],
      [land(4, 40), land(3, 30), land(5, 50)],
      4,
    );
    expect(out.rows[0]).toBe('334444');
    expect(out.log[0]).toEqual({ entry: 5, pixels: 3, to: 3 });
  });

  it('FR-117: ties between targets go to the first entry in map order', () => {
    const rows = ['222222', '222222', '..5...', '444444', '444444', '555555'];
    const first = okRows(rows, [land(2, 20), land(4, 40), land(5, 50)], 3);
    expect(first.rows[2]).toBe('..2...');
    const second = okRows(rows, [land(4, 40), land(2, 20), land(5, 50)], 3);
    expect(second.rows[2]).toBe('..4...');
  });

  it('FR-117: pieces are taken smallest first, ties by first pixel in row-major order', () => {
    const out = okRows(
      ['11441111', '11111111', '11311211', '11111111', '22333444', '22333444', '22333444', '22333444'],
      [land(1, 10), land(2, 20), land(3, 30), land(4, 40)],
      3,
    );
    expect(out.log).toEqual([
      { entry: 3, pixels: 1, to: 1 },
      { entry: 2, pixels: 1, to: 1 },
      { entry: 4, pixels: 2, to: 1 },
    ]);
    expect(out.rows.slice(0, 4)).toEqual(['11111111', '11111111', '11111111', '11111111']);
  });

  it('FR-117: a reassignment that merges pieces re-queues the merged piece when it is still below S', () => {
    const out = okRows(
      ['.......', '2311111', '.311111', '..11111', '.......', '2222...', '...3333'],
      [land(1, 10), land(2, 20), land(3, 30)],
      4,
    );
    expect(out.log).toEqual([
      { entry: 2, pixels: 1, to: 3 },
      { entry: 3, pixels: 3, to: 1 },
    ]);
    expect(out.rows[1]).toBe('1111111');
    expect(out.rows[2]).toBe('.111111');
  });

  it('FR-117: a merge that reaches S ends the cascade: the merged piece stays', () => {
    const out = okRows(
      ['.......', '2311111', '.311111', '..11111', '.......', '2222...', '...3333'],
      [land(1, 10), land(2, 20), land(3, 30)],
      3,
    );
    expect(out.log).toEqual([{ entry: 2, pixels: 1, to: 3 }]);
    expect(out.rows[1]).toBe('3311111');
  });

  it('FR-117: background pixels are never reassigned, whatever their size', () => {
    const out = okRows(['11111', '11.11', '11111', '11111', '11111'], [land(1, 10)], 4);
    expect(out.rows[1]).toBe('11.11');
    expect(out.log).toEqual([]);
  });

  it('FR-117: with no piece below S the pixels come back as an equal copy and the input is untouched', () => {
    const { width, pixels } = grid(['1122', '1122', '3322', '3322']);
    const before = Uint32Array.from(pixels);
    const result = cleanupPieces(width, pixels, [land(1, 1), land(2, 2), land(3, 3)], 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reassigned).toEqual([]);
    expect(result.value.pixels).toEqual(before);
    expect(result.value.pixels).not.toBe(pixels);
    expect(pixels).toEqual(before);
  });

  it('FR-117: a land entry left without a pixel fails with vanished-entry naming it, at the first such step', () => {
    const rows = ['111111', '111111', '115611', '111111', '111111', '111111'];
    const result = run(rows, [land(1, 10), land(5, 50), land(6, 60)], 3);
    expect(result).toEqual({ ok: false, errors: [{ kind: 'vanished-entry', territory: 5 }] });
  });

  it('FR-117: a sea zone left without a pixel fails with vanished-entry naming it', () => {
    const result = run(['111111', '111111', '117111', '111111', '111111', '111111'], [land(1, 10), sea(7)], 3);
    expect(result).toEqual({ ok: false, errors: [{ kind: 'vanished-entry', territory: 7 }] });
  });
});

/** A local deterministic generator (mulberry32); never Math.random. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A noisy Voronoi-like grid with speckles: many small pieces, merges, cascades, ties and vanishings. */
function randomCase(seed: number): { width: number; pixels: Uint32Array; entries: PieceEntry[]; s: number } {
  const next = prng(seed);
  const int = (n: number): number => Math.floor(next() * n);
  const width = 6 + int(11);
  const count = 3 + int(5);
  const entries: PieceEntry[] = [];
  const factions = 1 + int(3);
  for (let i = 1; i <= count; i++) {
    entries.push(next() < 0.3 ? { id: i, kind: 'sea' } : { id: i, kind: 'land', owner: 1 + int(factions) });
  }
  const sites = entries.flatMap((e) => {
    const n = 1 + int(2);
    return Array.from({ length: n }, () => ({ id: e.id, x: int(width), y: int(width) }));
  });
  const pixels = new Uint32Array(width * width);
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      const roll = next();
      if (roll < 0.08) {
        pixels[y * width + x] = 0;
      } else if (roll < 0.2) {
        pixels[y * width + x] = 1 + int(count);
      } else {
        let best = sites[0]!;
        let bestD = Infinity;
        for (const site of sites) {
          const d = (site.x - x) ** 2 + (site.y - y) ** 2 + next() * 2;
          if (d < bestD) {
            bestD = d;
            best = site;
          }
        }
        pixels[y * width + x] = best.id;
      }
    }
  }
  return { width, pixels, entries, s: 2 + int(7) };
}

describe('cleanupPieces identity with the literal loop', () => {
  it('FR-117: the incremental result equals the direct loop on 500 seeded random grids (pixels, log and error)', () => {
    let successes = 0;
    let failures = 0;
    let reassignments = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const { width, pixels, entries, s } = randomCase(seed);
      const fast = cleanupPieces(width, pixels, entries, s);
      const direct = cleanupDirect(width, pixels, entries, s);
      expect(fast, 'seed ' + seed).toEqual(direct);
      if (fast.ok) {
        successes++;
        reassignments += fast.value.reassigned.length;
      } else {
        failures++;
      }
    }
    // the generator must exercise both outcomes and plenty of work, or the identity proves little
    expect(successes).toBeGreaterThan(50);
    expect(failures).toBeGreaterThan(50);
    expect(reassignments).toBeGreaterThan(500);
  });

  it('FR-117: after a successful cleanup no piece is below S and background pixels are unchanged', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const { width, pixels, entries, s } = randomCase(seed);
      const result = cleanupPieces(width, pixels, entries, s);
      if (!result.ok) continue;
      expect(labelPieces(width, result.value.pixels).pieces.every((p) => p.size >= s)).toBe(true);
      for (let i = 0; i < pixels.length; i++) if (pixels[i] === 0) expect(result.value.pixels[i]).toBe(0);
    }
  });
});
