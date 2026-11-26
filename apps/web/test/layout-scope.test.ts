// Spec 040 (faster capture): the label layout of a fixed camera covers only what the camera can draw, and what it draws is
// exactly what the whole layout would draw (FR-740, FR-741, FR-742, FR-743). Real map: maps/spain-provinces, a round with unions.
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MapData, PresentationData } from '@mbrg/shared';
import { getRounds, getState, ownerOf, totalRounds } from '@mbrg/sim';
import type { Camera, Viewport } from '../src/core/camera';
import { CENTRE_PARAMS } from '../src/core/centre-params';
import { detailFactor } from '../src/core/detail-scale';
import { buildEntryIndex, factionIndexOf, ownerTable } from '../src/core/entries';
import { labelTexts } from '../src/core/label-input';
import type { LabelTexts } from '../src/core/label-input';
import { LABEL_PARAMS } from '../src/core/label-params';
import {
  READABLE_PARAMS,
  allCandidateTexts,
  factionCloseBlend,
  layoutScopeOf,
  placeReadableFactions,
  placeReadableTerritories,
  readableRoundLabels,
  resolveFrameLabels,
} from '../src/core/label-readable';
import type { LayoutScope, ReadableFactionTiers, ReadableTerritoryTiers } from '../src/core/label-readable';
import { parsePackage } from '../src/core/package';
import { buildPieceIndex, mainPieces } from '../src/core/regions';
import type { PieceIndex } from '../src/core/regions';
import { sceneAt } from '../src/core/scene';
import { SHAPE_PARAMS } from '../src/core/shape-params';
import { inflateStream } from '../src/ui/load';

interface World {
  readonly pieces: PieceIndex;
  readonly table: Uint16Array;
  readonly texts: LabelTexts;
  readonly aspects: ReadonlyMap<string, number>;
  readonly mainPieceOf: Int32Array;
  readonly width: number;
  readonly height: number;
  readonly focus: { x: number; y: number };
  readonly largest: { x: number; y: number };
  readonly full: { territories: ReadableTerritoryTiers; factions: ReadableFactionTiers };
}

let world: World;

const layout = (scope?: LayoutScope): { territories: ReadableTerritoryTiers; factions: ReadableFactionTiers } => {
  const { pieces, table, texts, aspects, mainPieceOf } = world;
  const territories = placeReadableTerritories(pieces, texts.territories, aspects, LABEL_PARAMS, SHAPE_PARAMS, CENTRE_PARAMS, scope);
  const factions = placeReadableFactions(pieces, table, texts.factions, aspects, LABEL_PARAMS, SHAPE_PARAMS, CENTRE_PARAMS, undefined, { territories, names: texts.territories, mainPieceOf }, scope);
  return { territories, factions };
};

const drawnWith = (made: { territories: ReadableTerritoryTiers; factions: ReadableFactionTiers }, camera: Camera, viewport: Viewport) =>
  resolveFrameLabels(readableRoundLabels(world.texts, world.table, made.factions, made.territories, world.aspects).draws, camera, viewport, READABLE_PARAMS, detailFactor({ w: world.width, h: world.height }, viewport));

const scopeFor = (camera: Camera, viewport: Viewport): LayoutScope =>
  layoutScopeOf(world.pieces, camera, viewport, detailFactor({ w: world.width, h: world.height }, viewport));

const countTiers = (made: { territories: ReadableTerritoryTiers; factions: ReadableFactionTiers }): number =>
  made.territories.tiers.filter((t) => t !== undefined).length + made.factions.tiers.size;

beforeAll(async () => {
  const dir = fileURLToPath(new URL('../../../maps/spain-provinces', import.meta.url));
  const parsed = await parsePackage(
    {
      map: readFileSync(join(dir, 'map.json'), 'utf8'),
      presentation: readFileSync(join(dir, 'presentation.json'), 'utf8'),
      image: new Uint8Array(readFileSync(join(dir, 'ids.png'))),
    },
    inflateStream,
  );
  if (!parsed.ok) throw new Error('package');
  const pkg = parsed.value;
  const map = pkg.map as MapData;
  const presentation = pkg.presentation as PresentationData;
  const index = buildEntryIndex(map, pkg.width, pkg.height, pkg.values);
  const pieces = buildPieceIndex(index);
  const owners = factionIndexOf(map);
  const sc = sceneAt(map, presentation, 10, 20, { totalRounds, getState, getRounds, ownerOf });
  if (!sc.ok) throw new Error('scene');
  const table = ownerTable(index, sc.value.owners, owners);
  const texts = labelTexts(map, presentation, owners);
  const aspects = new Map(
    allCandidateTexts([...texts.factions.values(), ...texts.territories.filter((t): t is string => t !== undefined)]).map((n) => [n, Math.max(0.6, Array.from(n).length * 0.58)]),
  );
  const mainPieceOf = mainPieces(pieces);
  const focusEntry = index.indexOf.get(map.territories[Math.floor(map.territories.length / 2)]!.id)!;
  const piece = mainPieceOf[focusEntry]!;
  const focus = { x: (pieces.box[piece * 4]! + pieces.box[piece * 4 + 2]!) / 2, y: (pieces.box[piece * 4 + 1]! + pieces.box[piece * 4 + 3]!) / 2 };
  let big = 0;
  for (let q = 1; q < pieces.size.length; q++) if (pieces.size[q]! > pieces.size[big]!) big = q;
  const largest = { x: (pieces.box[big * 4]! + pieces.box[big * 4 + 2]!) / 2, y: (pieces.box[big * 4 + 1]! + pieces.box[big * 4 + 3]!) / 2 };
  world = { pieces, table, texts, aspects, mainPieceOf, width: pkg.width, height: pkg.height, focus, largest, full: undefined as never };
  world = { ...world, full: layout() };
}, 60000);

describe('spec 040 FR-740 layoutScopeOf: the regions a fixed camera can draw', () => {
  it('FR-740 a region is in scope when one of its pieces meets the view widened by 32 px, and not otherwise', () => {
    const viewport: Viewport = { width: 1600, height: 900 };
    const camera: Camera = { ...world.focus, scale: 3 };
    const scope = scopeFor(camera, viewport);
    const { box } = world.pieces;
    // A synthetic piece list: find one piece well inside the view and one far outside it (the map is wider than the view).
    let inside = -1;
    let outside = -1;
    for (let piece = 0; piece < box.length / 4; piece++) {
      const cx = (box[piece * 4]! + box[piece * 4 + 2]!) / 2;
      const cy = (box[piece * 4 + 1]! + box[piece * 4 + 3]!) / 2;
      if (inside < 0 && Math.abs(cx - camera.x) < 60 && Math.abs(cy - camera.y) < 60) inside = piece;
      if (outside < 0 && Math.abs(cx - camera.x) > 600) outside = piece;
    }
    expect(inside).toBeGreaterThanOrEqual(0);
    expect(outside).toBeGreaterThanOrEqual(0);
    expect(scope.region([inside])).toBe(true);
    expect(scope.region([outside])).toBe(false);
    expect(scope.region([outside, inside])).toBe(true);
    expect(scope.region([])).toBe(false);
  });

  it('FR-740 the 32 px margin is in screen pixels: a piece just past the view edge is in scope, one well past it is not', () => {
    const viewport: Viewport = { width: 1000, height: 600 };
    const camera: Camera = { x: 2000, y: 1000, scale: 2 };
    // The view spans x in [1750, 2250]; the margin adds 16 map units at scale 2. Fake a one-piece index.
    const fake = { box: new Int32Array([2250, 900, 2260, 1000, 2280, 900, 2290, 1000]) } as unknown as PieceIndex;
    const near = layoutScopeOf(fake, camera, viewport, 1);
    expect(near.region([0])).toBe(true); // starts at 2250 < 2250 + 16
    expect(near.region([1])).toBe(false); // starts at 2280 > 2266
  });

  it('FR-741 the far and close flags follow the close-zoom blend of the camera', () => {
    const viewport: Viewport = { width: 1600, height: 900 };
    const at = (scale: number): LayoutScope => scopeFor({ x: 0, y: 0, scale }, viewport);
    const detail = detailFactor({ w: world.width, h: world.height }, viewport);
    for (const scale of [0.2, 0.85, 0.9, 0.95, 1, 1.5]) {
      const blend = factionCloseBlend(scale, detail);
      expect(at(scale).far).toBe(blend < 1);
      expect(at(scale).close).toBe(blend > 0);
    }
    expect(at(0.2)).toMatchObject({ far: true, close: false });
    expect(at(2)).toMatchObject({ far: false, close: true });
    expect(at(0.5 * 1.9 * detail)).toMatchObject({ far: true });
  });
});

describe('spec 040 FR-742 the scoped layout draws exactly what the whole layout draws (maps/spain-provinces, seed 10 round 20)', { timeout: 120000 }, () => {
  const viewport: Viewport = { width: 1600, height: 900 };
  const cases: readonly { name: string; view: () => Viewport; camera: () => Camera }[] = [
    { name: 'far zoom on a union (a province)', view: () => viewport, camera: () => ({ ...world.focus, scale: 0.9 * 0.5 }) },
    { name: 'blend zone', view: () => viewport, camera: () => ({ ...world.focus, scale: 0.92 }) },
    { name: 'close zoom', view: () => viewport, camera: () => ({ ...world.focus, scale: 1.4 }) },
    { name: 'round-like wide frame', view: () => viewport, camera: () => ({ x: world.width * 0.3, y: world.height * 0.5, scale: 0.45 }) },
    { name: 'the largest piece of land, close', view: () => viewport, camera: () => ({ ...world.largest, scale: 1.1 }) },
  ];
  for (const c of cases) {
    it(`FR-742 ${c.name}`, () => {
      const view = c.view();
      const camera = c.camera();
      const scoped = layout(scopeFor(camera, view));
      const reference = drawnWith(world.full, camera, view);
      expect(drawnWith(scoped, camera, view)).toStrictEqual(reference);
      expect(reference.length).toBeGreaterThan(0);
    });
  }

  it('FR-740 a small view lays out far fewer regions than the whole map', () => {
    const wide = layout(scopeFor({ ...world.focus, scale: 0.9 }, viewport));
    expect(countTiers(wide)).toBeLessThanOrEqual(countTiers(world.full));
    const near = layout(scopeFor({ ...world.focus, scale: 6 }, viewport));
    expect(countTiers(near)).toBeLessThan(countTiers(world.full) / 2);
    expect(countTiers(near)).toBeGreaterThan(0);
  });

  it('FR-741 a camera past the close zoom lays out no far tier unless the close tiers are empty, and one below it no close tier unless the far tiers are empty', () => {
    const closeScope = scopeFor({ ...world.focus, scale: 1.4 }, viewport);
    expect(closeScope).toMatchObject({ far: false, close: true });
    const closeOnly = layout(closeScope).factions;
    for (const faction of closeOnly.piecesByFaction.keys()) {
      const close = closeOnly.closeTiers?.get(faction);
      const far = closeOnly.tiers.get(faction);
      if (close === undefined && far === undefined) continue; // out of scope
      expect(close).toBeDefined();
      expect(far !== undefined).toBe(close!.length === 0);
    }
    const farScope = scopeFor({ ...world.focus, scale: 0.4 }, viewport);
    expect(farScope).toMatchObject({ far: true, close: false });
    const farOnly = layout(farScope).factions;
    for (const faction of farOnly.piecesByFaction.keys()) {
      const close = farOnly.closeTiers?.get(faction);
      const far = farOnly.tiers.get(faction);
      if (close === undefined && far === undefined) continue;
      expect(far).toBeDefined();
      expect(close !== undefined).toBe(far!.length === 0);
    }
  });

  it('FR-741 the kind a camera does not read is computed when the kind it reads is empty, and the drawing is still the whole layout', () => {
    // With the label aspects stretched 16 times a faction has no far tier but still has a close one.
    const stretched = new Map([...world.aspects].map(([name, aspect]) => [name, aspect * 16]));
    const { pieces, table, texts, mainPieceOf } = world;
    const run = (scope?: LayoutScope) => {
      const territories = placeReadableTerritories(pieces, texts.territories, stretched, LABEL_PARAMS, SHAPE_PARAMS, CENTRE_PARAMS, scope);
      const factions = placeReadableFactions(pieces, table, texts.factions, stretched, LABEL_PARAMS, SHAPE_PARAMS, CENTRE_PARAMS, undefined, { territories, names: texts.territories, mainPieceOf }, scope);
      return { territories, factions };
    };
    const whole = run();
    const farEmpty = [...whole.factions.tiers].filter(([faction, far]) => far.length === 0 && (whole.factions.closeTiers?.get(faction)?.length ?? 0) > 0).map(([faction]) => faction);
    expect(farEmpty.length).toBeGreaterThan(0);
    const farOnly: LayoutScope = { region: () => true, far: true, close: false };
    const scoped = run(farOnly);
    for (const [faction] of scoped.factions.tiers) {
      expect(scoped.factions.closeTiers?.has(faction)).toBe(farEmpty.includes(faction));
    }
    const camera: Camera = { x: world.width / 2, y: world.height / 2, scale: 0.4 };
    const draws = (made: typeof whole) =>
      resolveFrameLabels(readableRoundLabels(texts, table, made.factions, made.territories, stretched).draws, camera, viewport, READABLE_PARAMS, detailFactor({ w: world.width, h: world.height }, viewport));
    expect(draws(scoped)).toStrictEqual(draws(whole));
  });

  it('FR-740 a small view lays out fewer faction tiers of both kinds than the whole map', () => {
    const small: Viewport = { width: 300, height: 200 };
    const { region } = scopeFor({ ...world.focus, scale: 4 }, small);
    const scoped = layout({ region, far: true, close: true });
    expect(scoped.factions.tiers.size).toBeGreaterThan(0);
    expect(scoped.factions.tiers.size).toBeLessThan(world.full.factions.tiers.size);
    expect(scoped.factions.closeTiers!.size).toBeGreaterThan(0);
    expect(scoped.factions.closeTiers!.size).toBeLessThan(world.full.factions.closeTiers!.size);
  });

  it('FR-741 the tiers of an in-scope region are the very ones the whole layout computes', () => {
    const camera: Camera = { ...world.focus, scale: 0.4 };
    const scoped = layout(scopeFor(camera, viewport));
    let compared = 0;
    for (const [faction, tiers] of scoped.factions.tiers) {
      expect(tiers).toStrictEqual(world.full.factions.tiers.get(faction));
      compared++;
    }
    scoped.territories.tiers.forEach((tiers, entry) => {
      if (tiers !== undefined) {
        expect(tiers).toStrictEqual(world.full.territories.tiers[entry]);
        compared++;
      }
    });
    expect(compared).toBeGreaterThan(5);
  });
});

describe('spec 040 FR-743 only capture mode asks for a scope', () => {
  const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

  it('FR-743 no scope given = the whole layout: every region has both kinds of tiers', () => {
    const { factions } = world.full;
    expect(factions.tiers.size).toBeGreaterThan(10);
    expect(factions.closeTiers?.size).toBe(factions.tiers.size);
  });

  it('FR-740 capture mode sets layoutForCamera and no other scene does', () => {
    expect(read('../src/ui/capture-main.ts')).toContain('layoutForCamera: true');
    for (const other of ['../src/ui/main.ts', '../src/ui/live-main.ts']) expect(read(other)).not.toContain('layoutForCamera');
  });
});
