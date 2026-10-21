import { beforeAll, describe, expect, it } from 'vitest';
import { axisAngle, axisExtent } from '../src/core/label-axis';
import { CENTRE_PARAMS } from '../src/core/centre-params';
import { centreSums } from '../src/core/label-centre';
import { digestNumbers } from '../src/core/label-digest';
import { mainPieces } from '../src/core/regions';
import { withCentred } from './helpers/centred-digest-run';
import type { CentredDevRun } from './helpers/centred-digest-run';
import { afterFigures, beforeFigures, figureRow, formatAfterRow, formatRow } from './helpers/centred-figures';
import type { AfterRow, FigureRow } from './helpers/centred-figures';
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
    expect(linesDigest(lines)).toBe(BEFORE_DIGEST);
  });
});

const linesDigest = (lines: readonly string[]): string => {
  const codes: number[] = [];
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) codes.push(line.charCodeAt(i));
    codes.push(10);
  }
  return digestNumbers(codes);
};

// T8: the "after" columns, the 007 placement of the same run (same labels, same aspects, same helper).
// Re-pinned in T8b (spec D19: arc gain 1, territory arcs up to 75 degrees); T8 value was ba6fd9cbf0eda6da.
const AFTER_DIGEST = 'c0a00656027bb9bc';
const AFTER_ROWS: Readonly<Record<string, string>> = {
  'T Galicia': 'T Galicia | n19980 C(204.3,1208.3) rho19.8 | straight -45 h44 @(198.5,1214.5) | off (-5.8,6.2) d8.5 f0.060 | gaps - | in-land | k1 d/(k rho) 0.428',
  'T Castilla-La Mancha': 'T Castilla-La Mancha | n53635 C(504.8,1537.7) rho32.4 | straight 45 h33 @(501.5,1524.5) | off (-3.3,-13.2) d13.6 f0.059 | gaps - | in-land | k1 d/(k rho) 0.419',
  'T Baviera': 'T Baviera | n47174 C(1448.5,689.0) rho30.4 | arc -60 h71 @(1439.5,688.5) | off (-9.0,-0.5) d9.0 f0.041 | gaps - | in-land | k1 d/(k rho) 0.296',
  'T Bremen': 'T Bremen | n215 C(1269.2,318.5) rho2.1 | arc -30 h3 @(1269.5,318.5) | off (0.3,0.0) d0.3 f0.021 | gaps - | in-land | k1 d/(k rho) 0.150',
  'T Hamburgo': 'T Hamburgo | n517 C(1334.3,275.3) rho3.2 | arc -15 h4 @(1334.5,277.5) | off (0.2,2.2) d2.2 f0.096 | gaps - | in-land | k1 d/(k rho) 0.687',
  'T Trentino-Alto Adigio': 'T Trentino-Alto Adigio | n9115 C(1459.9,916.6) rho13.4 | arc 45 h14 @(1459.5,914.5) | off (-0.4,-2.1) d2.2 f0.023 | gaps - | in-land | k1 d/(k rho) 0.161',
  'T Friuli-Venecia Julia': 'T Friuli-Venecia Julia | n4935 C(1573.5,931.6) rho9.8 | arc -45 h9 @(1576.5,930.5) | off (3.0,-1.1) d3.2 f0.045 | gaps - | in-land | k1 d/(k rho) 0.322',
  'T Liguria': 'T Liguria | n3717 C(1306.4,1126.6) rho8.5 | straight 30 h7 @(1297.5,1112.5) | off (-8.9,-14.1) d16.6 f0.273 | gaps - | in-land | k2 d/(k rho) 0.974',
  'F r0 Italia': 'F r0 Italia | n169251 C(1550.1,1180.8) rho57.6 | straight -15 h87 @(1542.5,1208.5) | off (-7.6,27.7) d28.8 f0.070 | gaps - | in-land | k1 d/(k rho) 0.500',
  'F r1 Italia': 'F r1 Italia | n169251 C(1550.1,1180.8) rho57.6 | straight -15 h87 @(1542.5,1208.5) | off (-7.6,27.7) d28.8 f0.070 | gaps - | in-land | k1 d/(k rho) 0.500',
  'F r2 Italia': 'F r2 Italia | n169251 C(1550.1,1180.8) rho57.6 | straight -15 h87 @(1542.5,1208.5) | off (-7.6,27.7) d28.8 f0.070 | gaps - | in-land | k1 d/(k rho) 0.500',
  'F r3 Italia': 'F r3 Italia | n393071 C(424.5,1466.4) rho87.8 | arc 15 h133 @(424.5,1466.5) | off (0.0,0.1) d0.1 f0.000 | gaps - | in-land | k1 d/(k rho) 0.001',
  'F r2 España': 'F r2 España | n393071 C(424.5,1466.4) rho87.8 | arc 15 h111 @(424.5,1466.5) | off (0.0,0.1) d0.1 f0.000 | gaps - | in-land | k1 d/(k rho) 0.001',
  'F r4 Francia': 'F r4 Francia | n1165291 C(932.4,1056.7) rho151.1 | straight -30 h189 @(956.5,982.5) | off (24.1,-74.2) d78.0 f0.072 | gaps - | in-land | k1 d/(k rho) 0.516',
};

describe('NFR-46 the after figures (007 placement, measured aspects)', () => {
  let before: FigureRow[];
  let after: AfterRow[];
  let lines: string[];
  let run: CentredDevRun;

  beforeAll(async () => {
    const measured = await measuredRun();
    run = withCentred(measured);
    before = beforeFigures(measured);
    after = afterFigures(run);
    lines = after.map(formatAfterRow);
    console.log(`centred-figures: after table, ${after.length} rows, digest ${linesDigest(lines)}\n${lines.join('\n')}`);
  }, 120000);

  const find = (prefix: string): string => {
    const found = lines.filter((l) => l.startsWith(prefix));
    if (found.length !== 1) throw new Error(`${prefix}: ${found.length} rows`);
    return found[0]!;
  };
  const row = (role: 'territory' | 'faction', round: number, name: string): AfterRow => {
    const found = after.filter((r) => r.role === role && r.round === round && r.name === name);
    if (found.length !== 1) throw new Error(`${name}: ${found.length} rows`);
    return found[0]!;
  };

  it('NFR-46 the after table has the same 85 labels (70 territories, 15 faction labels) in the same order as the before table', () => {
    expect(after).toHaveLength(before.length);
    expect(after).toHaveLength(85);
    for (let i = 0; i < after.length; i++) {
      expect(after[i]!.role).toBe(before[i]!.role);
      expect(after[i]!.name).toBe(before[i]!.name);
      expect(after[i]!.round).toBe(before[i]!.round);
      expect(after[i]!.n).toBe(before[i]!.n);
    }
  });

  it('NFR-46 every 007 frame centre lies within k rho of the centre of mass at the widening step k it was chosen at, and every label is in-land', () => {
    for (const r of after) {
      expect(r.frame, r.name).toBeDefined();
      expect(r.status, r.name).toBe('in-land');
      expect(r.k, r.name).toBeGreaterThanOrEqual(1);
      expect(r.dist, `${r.name} d ${r.dist} k ${r.k} rho ${r.rho}`).toBeLessThanOrEqual(r.k * r.rho + 1e-9);
    }
    // All but one label (Liguria, the widened one) are found at step 1: within rho.
    expect(after.filter((r) => r.k > 1).map((r) => r.name)).toStrictEqual(['Liguria']);
  });

  it('NFR-46 Francia at round 4 is a straight frame at step 1 within rho of C (reference B is at 0.109 sqrt n), 369 units away in 006 and well under 151 now', () => {
    const f = row('faction', 4, 'Francia');
    expect(f.frame).toMatchObject({ shape: 'straight', angle: -30, h: 189 });
    expect(f.k).toBe(1);
    expect(f.dist).toBeLessThanOrEqual(f.rho);
    expect(f.dist).toBeLessThan(0.52 * f.rho + 1);
    const b = before.find((r) => r.role === 'faction' && r.round === 4)!;
    expect(b.dist).toBeGreaterThan(2 * b.rho);
  });

  it('NFR-46 Galicia and Castilla-La Mancha: the 007 frames are straight at +-45 deg (no side gaps), their offsets from C shrink from 20.2 and 49.3 units and from 0.143 and 0.213 sqrt n', () => {
    const g = row('territory', -1, 'Galicia');
    const c = row('territory', -1, 'Castilla-La Mancha');
    const gb = before.find((r) => r.name === 'Galicia')!;
    const cb = before.find((r) => r.name === 'Castilla-La Mancha')!;
    expect(gb.frame).toMatchObject({ shape: 'straight', angle: 90 });
    expect(cb.frame).toMatchObject({ shape: 'horizontal' });
    expect(cb.gaps).toBeDefined();
    expect(g.frame?.shape).toBe('straight');
    expect(c.frame?.shape).toBe('straight');
    expect(Math.abs(g.frame!.angle)).toBeLessThanOrEqual(45);
    expect(Math.abs(c.frame!.angle)).toBeLessThanOrEqual(45);
    expect(g.gaps).toBeUndefined();
    expect(c.gaps).toBeUndefined();
    expect(g.dist).toBeLessThan(gb.dist);
    expect(c.dist).toBeLessThan(cb.dist);
    expect(g.dist).toBeLessThanOrEqual(g.rho);
    expect(c.dist).toBeLessThanOrEqual(c.rho);
  });

  it('NFR-46 Italia at rounds 0..3: the faction label is within rho of its centre of mass (006: 0.557 and 0.013 sqrt n)', () => {
    for (const round of [0, 1, 2, 3]) {
      const r = row('faction', round, 'Italia');
      expect(r.k).toBe(1);
      expect(r.dist, `round ${String(round)}`).toBeLessThanOrEqual(r.rho);
    }
    expect(row('faction', 0, 'Italia').frame).toMatchObject({ shape: 'straight', angle: -15 });
    // D19: at round 3 the arc ties with the horizontal frame (h133) and wins the tie
    expect(row('faction', 3, 'Italia').frame).toMatchObject({ shape: 'arc', h: 133 });
    expect(row('faction', 3, 'Italia').dist).toBeLessThan(1);
  });

  it('NFR-46 D19 Portugal has no arc (straight 30 h39 at rounds 0 and 1, the known limit); España at round 2 is an arc h111', () => {
    for (const round of [0, 1]) expect(row('faction', round, 'Portugal').frame).toMatchObject({ shape: 'straight', angle: 30, h: 39 });
    expect(row('faction', 2, 'España').frame).toMatchObject({ shape: 'arc', h: 111 });
  });

  it('NFR-46 D19 arc counts per role, the 006 arcs that return, and the largest territory arc tangent', () => {
    const arcs = (rows: readonly FigureRow[], role: 'territory' | 'faction'): string[] => rows.filter((r) => r.role === role && r.frame?.shape === 'arc').map((r) => (role === 'faction' ? `r${String(r.round)} ${r.name}` : r.name));
    expect(arcs(after, 'territory')).toHaveLength(41);
    expect(arcs(after, 'faction')).toStrictEqual(['r2 España', 'r3 Italia']);
    const before006 = arcs(before, 'territory');
    expect(before006).toHaveLength(9);
    const back = before006.filter((n) => arcs(after, 'territory').includes(n));
    expect(back).toHaveLength(7);
    expect(before006.filter((n) => !back.includes(n)).sort()).toStrictEqual(['Comunidad Valenciana', 'Nueva Aquitania']);
    // largest absolute tangent of a territory arc (end tangents theta +- alpha, alpha = w |bend| / (2 L)), in degrees
    const main = mainPieces(run.p);
    let largest = 0;
    for (let e = 1; e < run.p.entries; e++) {
      const f = run.centredTerritories.inLand[e];
      if (f?.shape !== 'arc') continue;
      const alpha = (f.w * Math.abs(f.bend)) / (2 * axisExtent(run.p, [main[e]!], axisAngle(run.p, [main[e]!])));
      largest = Math.max(largest, Math.abs(f.angle) + alpha);
      expect(Math.abs(f.angle) + alpha, `entry ${String(e)}`).toBeLessThanOrEqual(CENTRE_PARAMS.arcTangentLimit.territory);
    }
    console.log(`centred-figures: largest territory arc tangent ${String(largest)}`);
    expect(largest).toBeGreaterThan(CENTRE_PARAMS.angleLimit);
  });

  it('NFR-46 the shape counts of the after table: territories 7 horizontal / 22 straight / 41 arc, faction labels 7 horizontal / 6 straight / 2 arc', () => {
    const count = (role: 'territory' | 'faction', shape: string): number => after.filter((r) => r.role === role && r.frame?.shape === shape).length;
    expect([count('territory', 'horizontal'), count('territory', 'straight'), count('territory', 'arc')]).toStrictEqual([7, 22, 41]);
    expect([count('faction', 'horizontal'), count('faction', 'straight'), count('faction', 'arc')]).toStrictEqual([7, 6, 2]);
  });

  it('NFR-46 the review labels of plan section 12 have the pinned after rows', () => {
    expect(Object.keys(AFTER_ROWS).length).toBeGreaterThan(0);
    for (const [prefix, line] of Object.entries(AFTER_ROWS)) expect(find(prefix), prefix).toBe(line);
  });

  it('NFR-46 the whole after table is pinned by a digest of its lines', () => {
    expect(linesDigest(lines)).toBe(AFTER_DIGEST);
  });
});
