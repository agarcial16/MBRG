import { beforeAll, describe, expect, it } from 'vitest';
import { totalRounds } from '@mbrg/sim';
import { parseAddress } from '../src/core/address';
import { LABEL_PARAMS } from '../src/core/label-params';
import { LABEL_REVIEW_SET, labelReviewAddress } from '../src/core/label-review-set';
import { drawnOf } from './helpers/shaped-hits';
import {
  DROPPED_SCENES,
  OFF_LAND_TUNING_SET,
  SHAPED_REVIEW_SET,
  STEP_HITS,
  TERRITORY_HITS,
  hitScale,
} from '../src/core/shaped-review-set';
import { OFF_LAND_HEIGHT_RANGE, SHAPE_PARAMS } from '../src/core/shape-params';
import { DEV_MAP, DEV_PRESENTATION } from './helpers/dev-map';
import { MEASURED_ASPECTS } from './helpers/measured-aspects';
import { centreOf, factionHit, heightOf, loadIndex, measuredRun, shapeParamsWith, stepHits, territoryHit } from './helpers/shaped-hits';
import type { HitKind, MeasuredRun } from './helpers/shaped-hits';

// NFR-40: the shaped review set is fixed data found with the aspects measured in Chrome (D10, U2). The hits are
// recorded for the territory off-land height in SHAPE_PARAMS; the user's choice of that value re-pins them.
const VIEWPORT = { width: 1920, height: 1080 };
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
const SLOW = env?.MBRG_SLOW === '1';

let run: MeasuredRun;
beforeAll(async () => {
  run = await measuredRun();
}, 120000);

describe('NFR-40 the measured text aspects (D10, U2)', () => {
  it('NFR-40 the fixture holds a positive finite aspect for every territory and faction name of the dev map', () => {
    const names = [...DEV_PRESENTATION.territories.map((t) => t.name), ...DEV_PRESENTATION.factions.map((f) => f.name)];
    expect(names.length).toBeGreaterThan(90);
    for (const name of names) {
      const aspect = MEASURED_ASPECTS[name];
      expect(aspect !== undefined && Number.isFinite(aspect) && aspect > 0, name).toBe(true);
    }
    expect(Object.keys(MEASURED_ASPECTS).length).toBe(new Set(names).size);
  });
});

describe('NFR-40 FR-203 the shaped review set addresses', () => {
  const all = [...SHAPED_REVIEW_SET, ...OFF_LAND_TUNING_SET];

  it('NFR-40 labels are unique kebab-case words, apart from the 005 set', () => {
    const labels = all.map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) expect(label, label).toMatch(/^[a-z]+(-[a-z0-9]+)*$/);
    const old = new Set(LABEL_REVIEW_SET.map((s) => s.label));
    for (const label of labels) expect(old.has(label), label).toBe(false);
  });

  it('NFR-40 every address parses with no problem and reads back the same scene and frozen progress', async () => {
    const total = totalRounds(DEV_MAP);
    if (!total.ok) throw new Error('total');
    for (const s of all) {
      const parsed = parseAddress(labelReviewAddress(s), total.value, { w: run.p.width, h: run.p.height }, VIEWPORT);
      expect(parsed.problems, s.label).toStrictEqual([]);
      expect(parsed.seed, s.label).toBe(s.seed);
      expect(parsed.round, s.label).toBe(s.round);
      if (s.frozen === undefined) expect(parsed.transition, s.label).toBeUndefined();
      else expect(parsed.transition, s.label).toStrictEqual({ value: Number(s.frozen), text: s.frozen });
      expect(parsed.camera, s.label).toBeDefined();
      // the camera is not moved by the clamp: the scene is centred where it says
      expect(Math.abs(parsed.camera!.x - s.camera!.x), s.label).toBeLessThan(0.06);
      expect(Math.abs(parsed.camera!.y - s.camera!.y), s.label).toBeLessThan(0.06);
      expect(parsed.camera!.scale, s.label).toBeCloseTo(s.camera!.zoom, 2);
    }
  });

  it('NFR-40 the crossfade scenes sit at L0, between L0 and L1 and at L1', () => {
    for (const prefix of ['crossfade-shaped', 'crossfade-off-land']) {
      const zooms = ['below', 'mid', 'above'].map((n) => SHAPED_REVIEW_SET.find((s) => s.label === `${prefix}-${n}`)!.camera!.zoom);
      expect(zooms).toStrictEqual([LABEL_PARAMS.fadeStart, (LABEL_PARAMS.fadeStart + LABEL_PARAMS.fadeFull) / 2, LABEL_PARAMS.fadeFull]);
    }
  });

  it('NFR-40 the step scenes freeze the five forward progress values of the recorded step, camera on the midpoint of the two frame centres', () => {
    const scenes = SHAPED_REVIEW_SET.filter((s) => s.label.startsWith('step-arc'));
    expect(scenes.map((s) => s.frozen)).toStrictEqual(['0', '0.25', '0.5', '0.75', '1']);
    const hit = STEP_HITS['step-arc'];
    for (const s of scenes) {
      expect([s.seed, s.round]).toStrictEqual([hit.seed, hit.round + 1]);
      expect(s.camera!.x).toBe((hit.before.x + hit.after.x) / 2);
      expect(s.camera!.y).toBe((hit.before.y + hit.after.y) / 2);
    }
  });
});

describe('NFR-40 FR-203 the recorded territory hits are the first ones in entry order', () => {
  it('NFR-40 each recorded hit is found first by the ordered search, with the recorded frame', () => {
    for (const [kind, record] of Object.entries(TERRITORY_HITS)) {
      const hit = territoryHit(run, kind as HitKind);
      expect(hit, kind).toBeDefined();
      expect(hit!.entry, kind).toBe(record.entry);
      expect(hit!.name, kind).toBe(record.name);
      expect(hit!.frame.shape, kind).toBe(record.shape);
      expect(centreOf(hit!.frame), kind).toStrictEqual(record.centre);
      expect(heightOf(hit!.frame), kind).toBe(record.height);
    }
  });

  it('NFR-40 the dropped scenes have no hit over the dev-map territories and the factions of seed 1', () => {
    expect(DROPPED_SCENES.map((d) => d.label)).toStrictEqual(['off-land-island', 'off-land-leader', 'off-land-faction-fit', 'step-straight', 'step-off-land']);
    expect(territoryHit(run, 'off-land-island')).toBeUndefined();
    expect(territoryHit(run, 'off-land-leader')).toBeUndefined();
    expect(factionHit(run, 'off-land')).toBeUndefined();
  });

  it('NFR-40 each hit scene is centred on its label, above L1 and large enough for the minimum text size', () => {
    for (const [kind, record] of Object.entries(TERRITORY_HITS)) {
      const scene = SHAPED_REVIEW_SET.find((s) => s.label === kind);
      expect(scene, kind).toBeDefined();
      expect(scene!.camera).toStrictEqual({ x: record.centre.x, y: record.centre.y, zoom: hitScale(record.height) });
      expect(scene!.camera!.zoom, kind).toBeGreaterThan(LABEL_PARAMS.fadeFull);
      expect(record.height * scene!.camera!.zoom, kind).toBeGreaterThanOrEqual(LABEL_PARAMS.minPx);
      expect(scene!.camera!.zoom, kind).toBeLessThanOrEqual(32);
    }
  });

  it('NFR-40 the first faction labels of the shaped kinds on seed 1 (aspects measured): an arc at round 0 and no steep or diagonal straight', () => {
    expect(factionHit(run, 'arc-cap')).toMatchObject({ round: 0, name: 'Portugal' });
    expect(factionHit(run, 'steep-straight')).toBeUndefined();
    expect(factionHit(run, 'diagonal-straight')).toBeUndefined();
  });
});

describe('NFR-40 the recorded step hit and the slow proofs of the dropped step scenes (D12)', () => {
  it('NFR-40 the ordered step search over seeds 1..12 finds the recorded arc step first and no straight or off-land one', async () => {
    const { index, p } = await loadIndex();
    const found = stepHits(index, p, STEP_HITS['step-arc'].seed, ['straight', 'arc', 'off-land']);
    expect([...found.hits.keys()]).toStrictEqual(['arc']);
    const arc = found.hits.get('arc')!;
    expect([arc.seed, arc.round, arc.name]).toStrictEqual([STEP_HITS['step-arc'].seed, STEP_HITS['step-arc'].round, STEP_HITS['step-arc'].faction]);
    expect(centreOf(arc.before)).toStrictEqual(STEP_HITS['step-arc'].before);
    expect(centreOf(arc.after)).toStrictEqual(STEP_HITS['step-arc'].after);
  }, 120000);

  it.skipIf(!SLOW)('NFR-40 MBRG_SLOW=1 no step of seeds 1..1000 has a straight or an off-land absorber pair (log for the PR)', async () => {
    const { index, p } = await loadIndex();
    const t0 = performance.now();
    const found = stepHits(index, p, 1000, ['straight', 'off-land']);
    console.log(`shaped-review-set: step search seeds 1..${found.seeds}, straight/off-land hits ${found.hits.size}, ${(performance.now() - t0).toFixed(0)} ms`);
    expect(found.hits.size).toBe(0);
    expect(found.seeds).toBe(1000);
  }, 900000);
});

describe('FR-203 NFR-40 the offLandHeight candidates', () => {
  it('FR-203 the candidates 3 and 4 and the current value lie inside the territory range', () => {
    for (const value of [3, 4, SHAPE_PARAMS.offLandHeight.territory]) {
      expect(value).toBeGreaterThanOrEqual(OFF_LAND_HEIGHT_RANGE.territory.min);
      expect(value).toBeLessThanOrEqual(OFF_LAND_HEIGHT_RANGE.territory.max);
    }
  });

  it('FR-203 NFR-40 what the tuning scenes show per candidate: the frames of Bremen and Hamburgo (recorded for the user choice)', async () => {
    const out: Record<number, string[]> = {};
    for (const value of [3, 4, 5]) {
      const candidate = value === SHAPE_PARAMS.offLandHeight.territory ? run : await measuredRun(shapeParamsWith(value));
      out[value] = ['Bremen', 'Hamburgo', 'Trentino-Alto Adigio', 'Friuli-Venecia Julia', 'Castilla-La Mancha'].map((name) => {
        const e = candidate.texts.territories.indexOf(name);
        const d = drawnOf(candidate.territories.placed[e], candidate.territories.inLand[e])!;
        const leader = d.shape === 'off-land' && d.leader !== undefined ? ' leader' : '';
        return `${name}:${d.shape}${leader}:${heightOf(d)}`;
      });
    }
    expect(out).toStrictEqual({
      3: ['Bremen:straight:3', 'Hamburgo:straight:4', 'Trentino-Alto Adigio:straight:14', 'Friuli-Venecia Julia:straight:9', 'Castilla-La Mancha:horizontal:29'],
      4: ['Bremen:off-land:4', 'Hamburgo:straight:4', 'Trentino-Alto Adigio:straight:14', 'Friuli-Venecia Julia:straight:9', 'Castilla-La Mancha:horizontal:29'],
      5: ['Bremen:off-land:5', 'Hamburgo:off-land:5', 'Trentino-Alto Adigio:straight:14', 'Friuli-Venecia Julia:straight:9', 'Castilla-La Mancha:horizontal:29'],
    });
  }, 120000);
});
