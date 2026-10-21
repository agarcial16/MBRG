import { beforeAll, describe, expect, it } from 'vitest';
import { centreSums } from '../src/core/label-centre';
import { digestNumbers } from '../src/core/label-digest';
import { beforeFigures, figureRow, formatRow } from './helpers/centred-figures';
import type { FigureRow } from './helpers/centred-figures';
import { devRun } from './helpers/label-digest-run';
import { measuredRun } from './helpers/shaped-hits';
import type { MeasuredRun } from './helpers/shaped-hits';

// NFR-46 figures of spec 007 (plan section 15). T2 pins the "before" columns: the retained 006 placement with the
// aspects measured in Chrome (plan PD10). T8 adds the "after" columns and compares them with the same helper.
const BEFORE_DIGEST = '0ce16eeca4e27140';
/** The review labels of plan section 12 (Galicia and Castilla-La Mancha with their side gaps) and the labels of the specs. */
const BEFORE_ROWS: Readonly<Record<string, string>> = {
  'T Galicia': 'T Galicia | n19980 C(204.3,1208.3) rho19.8 | straight 90 h50 @(224.5,1207.5) | off (20.2,-0.8) d20.2 f0.143 | gaps - | in-land',
  'T Castilla-La Mancha': 'T Castilla-La Mancha | n53635 C(504.8,1537.7) rho32.4 | horizontal 0 h29 @(497.7,1586.5) | off (-7.1,48.8) d49.3 f0.213 | gaps L20.0 R10.6 | in-land',
  'T Baviera': 'T Baviera | n47174 C(1448.5,689.0) rho30.4 | straight -75 h73 @(1433.5,693.5) | off (-15.0,4.5) d15.6 f0.072 | gaps - | in-land',
  'T Bremen': 'T Bremen | n215 C(1269.2,318.5) rho2.1 | straight -30 h3 @(1269.5,318.5) | off (0.3,0.0) d0.3 f0.021 | gaps - | in-land',
  'T Hamburgo': 'T Hamburgo | n517 C(1334.3,275.3) rho3.2 | straight -30 h4 @(1335.5,277.5) | off (1.2,2.2) d2.5 f0.109 | gaps - | in-land',
  'T Trentino-Alto Adigio': 'T Trentino-Alto Adigio | n9115 C(1459.9,916.6) rho13.4 | straight 45 h14 @(1465.5,921.5) | off (5.6,4.9) d7.4 f0.078 | gaps - | in-land',
  'T Friuli-Venecia Julia': 'T Friuli-Venecia Julia | n4935 C(1573.5,931.6) rho9.8 | straight -45 h9 @(1576.5,935.5) | off (3.0,3.9) d4.9 f0.069 | gaps - | in-land',
  'F r0 Italia': 'F r0 Italia | n169251 C(1550.1,1180.8) rho57.6 | horizontal 0 h120 @(1364.2,1047.0) | off (-186.0,-133.8) d229.1 f0.557 | gaps L62.0 R66.7 | in-land',
  'F r1 Italia': 'F r1 Italia | n169251 C(1550.1,1180.8) rho57.6 | horizontal 0 h120 @(1364.2,1047.0) | off (-186.0,-133.8) d229.1 f0.557 | gaps L62.0 R66.7 | in-land',
  'F r2 Italia': 'F r2 Italia | n169251 C(1550.1,1180.8) rho57.6 | horizontal 0 h120 @(1364.2,1047.0) | off (-186.0,-133.8) d229.1 f0.557 | gaps L62.0 R66.7 | in-land',
  'F r3 Italia': 'F r3 Italia | n393071 C(424.5,1466.4) rho87.8 | horizontal 0 h120 @(416.2,1467.0) | off (-8.3,0.6) d8.4 f0.013 | gaps L234.0 R302.7 | in-land',
  'F r4 Francia': 'F r4 Francia | n1165291 C(932.4,1056.7) rho151.1 | horizontal 0 h120 @(628.9,1267.0) | off (-303.5,210.3) d369.2 f0.342 | gaps L310.0 R1004.2 | in-land',
};

describe('NFR-46 the before figures (006 placement, measured aspects)', () => {
  let run: MeasuredRun;
  let rows: FigureRow[];
  let lines: string[];

  beforeAll(async () => {
    run = await measuredRun();
    rows = beforeFigures(run);
    lines = rows.map(formatRow);
    console.log(`centred-figures: before table, ${rows.length} rows\n${lines.join('\n')}`);
  }, 120000);

  const find = (prefix: string): string => {
    const found = lines.filter((l) => l.startsWith(prefix));
    if (found.length !== 1) throw new Error(`${prefix}: ${found.length} rows`);
    return found[0]!;
  };

  it('NFR-46 the table has a row for every eligible territory label and every faction label of rounds 0..T', () => {
    const territories = rows.filter((r) => r.role === 'territory');
    const factions = rows.filter((r) => r.role === 'faction');
    expect(territories).toHaveLength(run.territories.eligible.reduce((a, v) => a + v, 0));
    let expected = 0;
    for (const layout of run.factions) expected += layout.boxes.labels.size;
    expect(factions).toHaveLength(expected);
    expect(run.rounds).toBe(4);
  });

  it('NFR-46 n and C of every row equal the exact sums, and rho is q x sqrt(n)', () => {
    for (const r of rows) {
      expect(r.n, r.name).toBeGreaterThan(0);
      expect(r.rho).toBeCloseTo(0.14 * Math.sqrt(r.n), 9);
    }
    const label = [...run.factions[4]!.boxes.labels.values()][0]!;
    const s = centreSums(run.p, label.pieces);
    const row = rows.find((r) => r.role === 'faction' && r.round === 4)!;
    expect(BigInt(row.n)).toBe(s.n);
    expect(row.cx).toBeCloseTo(Number(s.sx) / Number(s.n) + 0.5, 6);
    expect(row.cy).toBeCloseTo(Number(s.sy) / Number(s.n) + 0.5, 6);
  });

  it('NFR-46 Francia at round 4 (n 1,165,291, C near (932, 1056), rho 151) is horizontal h 120 far outside the centre disc in 006, with the injected aspect 4 and with the measured one', async () => {
    const dev = await devRun();
    const layout = dev.factions[4]!;
    expect(layout.boxes.labels.size).toBe(1);
    const [faction, label] = [...layout.boxes.labels.entries()][0]!;
    const injected = figureRow(dev.p, 'faction', 4, 'Francia', label.pieces, layout.inLand.get(faction), layout.placed.get(faction));
    // The spec evidence quotes (343, 1214), 610 units from C; the retained 006 code gives the positions below at
    // every plausible aspect (plan section 15 records the difference). Both are horizontal h 120, far beyond rho.
    expect(injected.n).toBe(1165291);
    expect(Math.abs(injected.cx - 932)).toBeLessThan(1);
    expect(Math.abs(injected.cy - 1056)).toBeLessThan(1);
    expect(Math.round(injected.rho)).toBe(151);
    expect(injected.frame).toMatchObject({ shape: 'horizontal', h: 120 });
    expect(injected.dist).toBeGreaterThan(2 * injected.rho);
    const measured = rows.find((r) => r.role === 'faction' && r.round === 4)!;
    expect(measured.frame).toMatchObject({ shape: 'horizontal', h: 120 });
    expect(measured.dist).toBeGreaterThan(2 * measured.rho);
  });

  it('NFR-46 q = 7/50 check: the two evidence frames lie within rho of the Francia round 4 centre of mass, and 3/25 would exclude the h 160 one', () => {
    const row = rows.find((r) => r.role === 'faction' && r.round === 4)!;
    const away = (x: number, y: number): number => Math.sqrt((x - row.cx) * (x - row.cx) + (y - row.cy) * (y - row.cy));
    const h160 = away(972, 916); // +40 deg, h 160 (spec measured evidence)
    const refB = away(905, 941); // reference B, +40 deg, h 155
    expect(h160).toBeLessThanOrEqual(0.14 * Math.sqrt(row.n));
    expect(refB).toBeLessThanOrEqual(0.14 * Math.sqrt(row.n));
    expect(h160).toBeGreaterThan(0.12 * Math.sqrt(row.n));
    expect(h160 / Math.sqrt(row.n)).toBeCloseTo(0.135, 2);
    expect(refB / Math.sqrt(row.n)).toBeCloseTo(0.109, 2);
  });

  it('NFR-46 the review labels of plan section 12 have the pinned before rows', () => {
    for (const [prefix, line] of Object.entries(BEFORE_ROWS)) expect(find(prefix), prefix).toBe(line);
    expect(Object.keys(BEFORE_ROWS).length).toBeGreaterThan(0);
  });

  it('NFR-46 the whole before table is pinned by a digest of its lines', () => {
    const codes: number[] = [];
    for (const line of lines) {
      for (let i = 0; i < line.length; i++) codes.push(line.charCodeAt(i));
      codes.push(10);
    }
    expect(digestNumbers(codes)).toBe(BEFORE_DIGEST);
  });
});
