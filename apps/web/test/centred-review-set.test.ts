import { beforeAll, describe, expect, it } from 'vitest';
import { totalRounds } from '@mbrg/sim';
import { parseAddress } from '../src/core/address';
import {
  CENTRED_DROPPED_SCENES,
  CENTRED_REVIEW_SET,
  CENTRED_STEP_HIT,
  FRANCIA_R4_CENTRE,
  ITALIA_CENTRES,
  NAMED_CLOSE_UPS,
  SHAPE_CHANGE_CLOSE_UPS,
  STEEP_CLOSE_UPS,
  slug,
} from '../src/core/centred-review-set';
import type { CloseUpRecord } from '../src/core/centred-review-set';
import { centreSums } from '../src/core/label-centre';
import { LABEL_PARAMS } from '../src/core/label-params';
import { LABEL_REVIEW_SET, labelReviewAddress } from '../src/core/label-review-set';
import { mainRegions, regionsOf } from '../src/core/regions';
import { SHAPED_REVIEW_SET, hitScale } from '../src/core/shaped-review-set';
import { centredMeasuredRun, centredStepHit, centreOf, changedShape, heightOf, massCentre, steepTerritories, territoryFrames } from './helpers/centred-hits';
import type { CentredDevRun } from './helpers/centred-digest-run';
import { DEV_MAP } from './helpers/dev-map';
import { loadIndex } from './helpers/shaped-hits';

// NFR-45: the centred review set is fixed data found with the aspects measured in Chrome (PD10). The recorded names
// have no accents; the dev-map names are compared after removing them.
const VIEWPORT = { width: 1920, height: 1080 };
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
const SLOW = env?.MBRG_SLOW === '1';
const plain = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

let run: CentredDevRun;
beforeAll(async () => {
  run = await centredMeasuredRun();
}, 240000);

describe('NFR-45 the centred review set addresses', () => {
  it('NFR-45 labels are unique kebab-case words, apart from the 005 and 006 sets', () => {
    const labels = CENTRED_REVIEW_SET.map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) expect(label, label).toMatch(/^[a-z]+(-[a-z0-9]+)*$/);
    const old = new Set([...LABEL_REVIEW_SET, ...SHAPED_REVIEW_SET].map((s) => s.label));
    for (const label of labels) expect(old.has(label), label).toBe(false);
    expect(labels.length).toBe(5 + 1 + 4 + 5 + 6 + 12 + 6);
  });

  it('NFR-45 every address parses with no problem and reads back the same scene and frozen progress', async () => {
    const total = totalRounds(DEV_MAP);
    if (!total.ok) throw new Error('total');
    for (const s of CENTRED_REVIEW_SET) {
      const parsed = parseAddress(labelReviewAddress(s), total.value, { w: run.p.width, h: run.p.height }, VIEWPORT);
      expect(parsed.problems, s.label).toStrictEqual([]);
      expect(parsed.seed, s.label).toBe(s.seed);
      expect(parsed.round, s.label).toBe(s.round);
      if (s.frozen === undefined) expect(parsed.transition, s.label).toBeUndefined();
      else expect(parsed.transition, s.label).toStrictEqual({ value: Number(s.frozen), text: s.frozen });
      if (s.camera !== undefined && s.camera.zoom > 0.5) {
        // the camera is not moved by the clamp: the scene is centred where it says
        expect(Math.abs(parsed.camera!.x - s.camera.x), s.label).toBeLessThan(0.06);
        expect(Math.abs(parsed.camera!.y - s.camera.y), s.label).toBeLessThan(0.06);
        expect(parsed.camera!.scale, s.label).toBeCloseTo(s.camera.zoom, 2);
      }
    }
  });

  it('NFR-45 the fit scenes cover rounds 0 to 4 and round 4 is the round T of seed 1', () => {
    const fits = CENTRED_REVIEW_SET.filter((s) => /^fit-r\d$/.test(s.label));
    expect(fits.map((s) => [s.seed, s.round, s.camera])).toStrictEqual([0, 1, 2, 3, 4].map((r) => [1, r, undefined]));
    expect(run.rounds).toBe(4);
    const francia = CENTRED_REVIEW_SET.find((s) => s.label === 'francia-r4')!;
    expect([francia.seed, francia.round]).toStrictEqual([1, 4]);
    expect([francia.camera!.x, francia.camera!.y]).toStrictEqual([FRANCIA_R4_CENTRE.x, FRANCIA_R4_CENTRE.y]);
  });

  it('NFR-45 the step scenes freeze the five forward progress values, camera on the midpoint of the two frame centres', () => {
    const scenes = CENTRED_REVIEW_SET.filter((s) => s.label.startsWith('step-straight'));
    expect(scenes.map((s) => s.frozen)).toStrictEqual(['0', '0.25', '0.5', '0.75', '1']);
    for (const s of scenes) {
      expect([s.seed, s.round]).toStrictEqual([CENTRED_STEP_HIT.seed, CENTRED_STEP_HIT.round + 1]);
      expect(s.camera!.x).toBe((CENTRED_STEP_HIT.before.x + CENTRED_STEP_HIT.after.x) / 2);
      expect(s.camera!.y).toBe((CENTRED_STEP_HIT.before.y + CENTRED_STEP_HIT.after.y) / 2);
    }
  });
});

describe('NFR-45 the recorded step hit is the first one in order (seed 1 first)', () => {
  it('NFR-45 the ordered search finds the Francia step 3 to 4 of seed 1 first: horizontal before, straight after', async () => {
    const { index, p } = await loadIndex();
    const { hit, seeds } = centredStepHit(index, p, 1);
    expect(seeds).toBe(1);
    expect(hit).toBeDefined();
    expect([hit!.seed, hit!.round, hit!.name]).toStrictEqual([CENTRED_STEP_HIT.seed, CENTRED_STEP_HIT.round, CENTRED_STEP_HIT.faction]);
    expect(hit!.before.shape).toBe('horizontal');
    expect(hit!.after.shape).toBe('straight');
    expect(centreOf(hit!.before)).toStrictEqual(CENTRED_STEP_HIT.before);
    expect(centreOf(hit!.after)).toStrictEqual(CENTRED_STEP_HIT.after);
  }, 120000);

  it.skipIf(!SLOW)('NFR-45 MBRG_SLOW=1 no step before seed 1 round 3 exists, so seeds 2..1000 are never needed (log for the PR)', async () => {
    const { index, p } = await loadIndex();
    const found = centredStepHit(index, p, 1000);
    console.log(`centred-review-set: first horizontal-to-straight step seed ${String(found.hit?.seed)} round ${String(found.hit?.round)}, seeds searched ${String(found.seeds)}`);
    expect(found.hit?.seed).toBe(1);
  }, 900000);
});

describe('NFR-45 the territory close-up lists equal what the 006 and 007 layouts give', () => {
  const check = (r: CloseUpRecord): void => {
    expect(plain(run.texts.territories[r.entry]!), r.name).toBe(plain(r.name));
    expect(massCentre(run.p, r.entry), r.name).toStrictEqual(r.centre);
    const { before, after } = territoryFrames(run, r.entry);
    expect(Math.min(heightOf(before!), heightOf(after!)), r.name).toBe(r.height);
  };

  it('NFR-45 the named close-ups are Galicia, Castilla-La Mancha and the four 006 review territories', () => {
    expect(NAMED_CLOSE_UPS.map((r) => r.name)).toStrictEqual(['Galicia', 'Castilla-La Mancha', 'Bremen', 'Hamburgo', 'Trentino-Alto Adigio', 'Friuli-Venecia Julia']);
    NAMED_CLOSE_UPS.forEach(check);
  });

  it('NFR-45 the steep list is every territory with a 006 straight frame steeper than 45 degrees (entry order), Galicia in the named list', () => {
    const scan = steepTerritories(run);
    expect(scan).toStrictEqual([...STEEP_CLOSE_UPS.map((r) => r.entry), 26].sort((a, b) => a - b));
    expect(scan).toHaveLength(13);
    STEEP_CLOSE_UPS.forEach(check);
    for (const entry of scan) {
      const { after } = territoryFrames(run, entry);
      expect(after!.shape === 'straight' ? Math.abs(after!.angle) <= 45 : true, `entry ${String(entry)}`).toBe(true);
    }
  });

  it('NFR-45 the shape-change close-ups are among the 25 horizontal-to-straight and 9 arc-to-straight territories', () => {
    const hs = changedShape(run, 'horizontal', 'straight');
    const as = changedShape(run, 'arc', 'straight');
    expect([hs.length, as.length]).toStrictEqual([25, 9]);
    for (const r of SHAPE_CHANGE_CLOSE_UPS) {
      expect((r.from === 'horizontal' ? hs : as).includes(r.entry), r.name).toBe(true);
      check(r);
    }
    expect(SHAPE_CHANGE_CLOSE_UPS.filter((r) => r.from === 'horizontal')).toHaveLength(3);
    expect(SHAPE_CHANGE_CLOSE_UPS.filter((r) => r.from === 'arc')).toHaveLength(3);
  });

  it('NFR-45 each close-up scene is centred on its territory, above L1 and large enough for the minimum text size', () => {
    for (const r of [...NAMED_CLOSE_UPS, ...STEEP_CLOSE_UPS, ...SHAPE_CHANGE_CLOSE_UPS]) {
      const scene = CENTRED_REVIEW_SET.find((s) => s.label.endsWith(`-${slug(r.name)}`) && s.camera?.x === r.centre.x);
      expect(scene, r.name).toBeDefined();
      expect(scene!.camera, r.name).toStrictEqual({ x: r.centre.x, y: r.centre.y, zoom: hitScale(r.height) });
      expect(scene!.camera!.zoom, r.name).toBeGreaterThan(LABEL_PARAMS.fadeFull);
      expect(r.height * scene!.camera!.zoom, r.name).toBeGreaterThanOrEqual(LABEL_PARAMS.minPx);
      expect(scene!.camera!.zoom, r.name).toBeLessThanOrEqual(32);
    }
  });

  it('NFR-45 Italia is centred on the centre of mass of its main region at rounds 0 to 3, and Francia on C at round 4', () => {
    const italia = [...run.texts.factions].find(([, name]) => name === 'Italia')![0];
    const francia = [...run.texts.factions].find(([, name]) => name === 'Francia')![0];
    const round1 = (v: number): number => Math.round(v * 10) / 10;
    const centreOfMain = (round: number, faction: number): { x: number; y: number } => {
      const region = mainRegions(regionsOf(run.p, run.tables[round]!)).get(faction)!;
      const s = centreSums(run.p, region.pieces);
      return { x: round1(Number(s.sx) / Number(s.n) + 0.5), y: round1(Number(s.sy) / Number(s.n) + 0.5) };
    };
    for (let round = 0; round <= 3; round++) expect(centreOfMain(round, italia), `round ${String(round)}`).toStrictEqual(ITALIA_CENTRES[round]);
    expect(centreOfMain(4, francia)).toStrictEqual(FRANCIA_R4_CENTRE);
    const scenes = CENTRED_REVIEW_SET.filter((s) => /^italia-r\d$/.test(s.label));
    expect(scenes.map((s) => s.round)).toStrictEqual([0, 1, 2, 3]);
    scenes.forEach((s, i) => expect(s.camera).toStrictEqual({ x: ITALIA_CENTRES[i]!.x, y: ITALIA_CENTRES[i]!.y, zoom: LABEL_PARAMS.fadeStart - 0.25 }));
  });
});

describe('NFR-45 FR-221 the dropped scene', () => {
  it('NFR-45 FR-221 the 006 steep-straight scene is dropped: no 007 frame of any label is steeper than 45 degrees', () => {
    expect(CENTRED_DROPPED_SCENES.map((d) => d.label)).toStrictEqual(['steep-straight']);
    const frames = [
      ...run.centredTerritories.inLand.filter((f) => f !== undefined),
      ...run.centredFactions.flatMap((f) => [...f.inLand.values()]).filter((f) => f !== undefined),
    ];
    expect(frames.length).toBeGreaterThan(80);
    for (const f of frames) if (f!.shape === 'straight') expect(Math.abs(f!.angle)).toBeLessThanOrEqual(45);
  });
});
