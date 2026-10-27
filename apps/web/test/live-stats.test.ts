// The facts the left column shows (spec 010 FR-360 to FR-362): the chronicle of the rounds and the factions with their falls,
// eliminations (bajas) and conquered territory, computed in the browser from the public records of rounds 1 to N. The expected
// values are computed here independently from the scripted match, never from the module under test.
import { describe, expect, it } from 'vitest';
import type { LiveModel } from '../src/core/live-model';
import { chronicle, factionRows, missingRecords, searchRows, sortRows, visibleRows, type FactionRow } from '../src/core/live-stats';
import { DEV_PRESENTATION } from './helpers/dev-map';
import { Driver, eventsOfRound, scripted, type Scripted } from './helpers/scripted-match';

const factions = DEV_PRESENTATION.factions.map((f) => ({ id: f.id, name: f.name }));
const nameOf = (id: number): string => factions.find((f) => f.id === id)?.name as string;
const none = { revealing: false, absorbing: false } as const;

/** A model that followed the match from round 0: it holds the record of every applied round up to `n`. */
async function followed(s: Scripted, n: number): Promise<LiveModel> {
  const d = new Driver(s);
  await d.load(0);
  for (let k = 1; k <= n; k++) await d.events(eventsOfRound(s, k));
  return d.model;
}
/** A model that joined at round n: it holds states but none of the earlier records. */
async function joined(s: Scripted, n: number): Promise<LiveModel> {
  const d = new Driver(s);
  await d.load(n);
  return d.model;
}

/** Independent expectations from the scripted records. */
function expected(s: Scripted, upTo: number): Map<number, { bajas: number; conq: number; fell: number | undefined }> {
  const out = new Map<number, { bajas: number; conq: number; fell: number | undefined }>();
  for (const f of factions) out.set(f.id, { bajas: 0, conq: 0, fell: undefined });
  for (let k = 1; k <= upTo; k++) {
    const r = s.records[k - 1]!;
    const a = out.get(r.absorber)!;
    a.bajas += 1;
    a.conq += r.transferred.length;
    out.get(r.eliminated)!.fell = k;
  }
  return out;
}

describe('FR-362 the facts come from the public records, in the browser', () => {
  it('FR-362 with the whole history held, bajas, conquered territory and the round of the fall equal the records, at every round up to N', async () => {
    const s = await scripted();
    for (const n of [1, 2, s.total]) {
      const model = await followed(s, n);
      const rows = factionRows(model, factions, n);
      const want = expected(s, n);
      for (const row of rows) {
        const w = want.get(row.id)!;
        expect([row.id, row.bajas, row.conq, row.fell], `round ${n}`).toStrictEqual([row.id, w.bajas, w.conq, w.fell]);
        expect(row.alive).toBe(w.fell === undefined);
        expect(row.territories).toBe(s.states[n]!.filter((p) => p[1] === row.id).length);
      }
    }
  });

  it('FR-362 a replay counts only the rounds up to the displayed one: the same model at round 1 shows round 1 facts', async () => {
    const s = await scripted();
    const model = await followed(s, 3);
    const rows = factionRows(model, factions, 1);
    const want = expected(s, 1);
    for (const row of rows) expect([row.bajas, row.fell]).toStrictEqual([want.get(row.id)!.bajas, want.get(row.id)!.fell]);
  });

  it('FR-362 a late joiner has no history: bajas and conquered are unknown (never a partial count), the territories are known', async () => {
    const s = await scripted();
    const model = await joined(s, 2);
    const rows = factionRows(model, factions, 2);
    for (const row of rows) {
      expect(row.bajas, nameOf(row.id)).toBeUndefined();
      expect(row.conq).toBeUndefined();
      expect(row.fell).toBeUndefined();
      expect(row.territories).toBe(s.states[2]!.filter((p) => p[1] === row.id).length);
    }
    expect(missingRecords(model, 2)).toStrictEqual([2, 1]);
  });

  it('FR-362 the missing records are listed newest first and never above the round asked', async () => {
    const s = await scripted();
    const model = await joined(s, 3);
    expect(missingRecords(model, 3)).toStrictEqual([3, 2, 1]);
    expect(missingRecords(model, 1)).toStrictEqual([1]);
    expect(missingRecords(model, 0)).toStrictEqual([]);
    expect(missingRecords(await followed(s, 3), 3)).toStrictEqual([]);
  });

  it('FR-362 a fall is known even with a partial history when the record of that round is held', async () => {
    const s = await scripted();
    const model = await joined(s, 2);
    const record = s.records[1]!;
    const partial = { ...model, records: new Map(model.records).set(2, record) };
    const rows = factionRows(partial, factions, 2);
    expect(rows.find((r) => r.id === record.eliminated)?.fell).toBe(2);
    expect(rows.find((r) => r.id === record.absorber)?.bajas).toBeUndefined();
  });
});

describe('FR-361 sorting, searching and the cap of the factions list', () => {
  const row = (id: number, name: string, territories: number, bajas: number | undefined, conq: number | undefined, fell?: number): FactionRow => ({
    id,
    name,
    territories,
    alive: fell === undefined,
    bajas,
    conq,
    fell,
  });
  const rows = [
    row(1, 'Alemania', 16, 1, 9),
    row(2, 'España', 16, 0, 0),
    row(3, 'Francia', 33, 2, 41),
    row(4, 'Italia', 0, 0, 0, 1),
    row(5, 'Portugal', 5, undefined, undefined),
    row(6, 'Austria', 0, 0, 0, 2),
  ];
  const names = (list: readonly FactionRow[]): string[] => list.map((r) => r.name);

  it('FR-361 by territory, largest first, ties by name; the fallen go last, the latest fall first', () => {
    expect(names(sortRows(rows, 'territories'))).toStrictEqual(['Francia', 'Alemania', 'España', 'Portugal', 'Austria', 'Italia']);
  });

  it('FR-361 by bajas and by conquered, largest first; unknown values go after the known ones; the fallen go last', () => {
    expect(names(sortRows(rows, 'bajas'))).toStrictEqual(['Francia', 'Alemania', 'España', 'Portugal', 'Austria', 'Italia']);
    expect(names(sortRows(rows, 'conq'))).toStrictEqual(['Francia', 'Alemania', 'España', 'Portugal', 'Austria', 'Italia']);
    const tied = [row(1, 'B', 5, 1, 1), row(2, 'A', 5, 1, 1), row(3, 'C', 5, undefined, undefined)];
    expect(names(sortRows(tied, 'bajas'))).toStrictEqual(['A', 'B', 'C']);
  });

  it('FR-361 sorting never changes the list it is given', () => {
    const copy = JSON.stringify(rows);
    sortRows(rows, 'bajas');
    expect(JSON.stringify(rows)).toBe(copy);
  });

  it('FR-361 the search matches a faction name without regard to case or accents, or a round of fall ("2", "ronda 2")', () => {
    expect(names(searchRows(rows, 'espana'))).toStrictEqual(['España']);
    expect(names(searchRows(rows, 'ESP'))).toStrictEqual(['España']);
    expect(names(searchRows(rows, '2'))).toStrictEqual(['Austria']);
    expect(names(searchRows(rows, 'ronda 1'))).toStrictEqual(['Italia']);
    expect(names(searchRows(rows, '  '))).toStrictEqual(names(rows));
    expect(searchRows(rows, 'zzz')).toStrictEqual([]);
  });

  it('FR-361 with more than 12 factions the list shows 12 and says how many are hidden; with 12 or fewer it shows all', () => {
    const many = Array.from({ length: 30 }, (_, i) => row(i + 1, `F${String(i).padStart(2, '0')}`, 30 - i, 0, 0));
    expect(visibleRows(many, 12, false)).toStrictEqual({ shown: many.slice(0, 12), hidden: 18 });
    expect(visibleRows(many, 12, true)).toStrictEqual({ shown: many, hidden: 0 });
    expect(visibleRows(many.slice(0, 12), 12, false)).toStrictEqual({ shown: many.slice(0, 12), hidden: 0 });
    expect(visibleRows([], 12, false)).toStrictEqual({ shown: [], hidden: 0 });
  });
});

describe('FR-360 the chronicle', () => {
  it('FR-360 one entry per applied round with a known record, newest first: round, victim, absorber and territories taken', async () => {
    const s = await scripted();
    const model = await followed(s, 3);
    const entries = chronicle(model, factions, 3, none);
    const applied = entries.filter((e) => e.status === 'applied');
    expect(applied.map((e) => e.round)).toStrictEqual([3, 2, 1]);
    for (const e of applied) {
      const r = s.records[e.round - 1]!;
      expect(e).toMatchObject({ victim: nameOf(r.eliminated), absorber: nameOf(r.absorber), taken: r.transferred.length });
    }
  });

  it('FR-360 a replay at round 1 lists round 1 only', async () => {
    const s = await scripted();
    const model = await followed(s, 3);
    expect(chronicle(model, factions, 1, none).map((e) => e.round)).toStrictEqual([1]);
  });

  it('FR-360 a late joiner lists only the rounds whose record it holds', async () => {
    const s = await scripted();
    const model = await joined(s, 2);
    expect(chronicle(model, factions, 2, none)).toStrictEqual([]);
  });

  it('FR-360 the round whose victim is revealed shows the victim only, never the absorber, and nothing but a wait text while the tour runs', async () => {
    const s = await scripted();
    const d = new Driver(s);
    await d.load(0);
    await d.events(eventsOfRound(s, 1).slice(0, 3));
    const record = s.records[0]!;
    const shown = chronicle(d.model, factions, 0, none);
    expect(shown).toStrictEqual([{ status: 'pending', round: 1, victim: nameOf(record.eliminated) }]);
    const revealing = chronicle(d.model, factions, 0, { revealing: true, absorbing: false });
    expect(revealing).toStrictEqual([{ status: 'pending', round: 1, victim: undefined }]);
    expect(Object.keys(shown[0]!).sort()).toStrictEqual(['round', 'status', 'victim']);
  });

  it('FR-360 while the absorber tour runs the applied round stays a pending entry with its victim: its absorber is not in the chronicle yet', async () => {
    const s = await scripted();
    const model = await followed(s, 2);
    const record = s.records[1]!;
    const hidden = chronicle(model, factions, 1, { revealing: false, absorbing: true });
    expect(hidden.map((e) => `${e.status}:${e.round}`)).toStrictEqual(['pending:2', 'applied:1']);
    expect(hidden[0]).toStrictEqual({ status: 'pending', round: 2, victim: nameOf(record.eliminated) });
    const text = JSON.stringify(hidden[0]);
    expect(text).not.toMatch(/absorber|taken/);
  });
});
