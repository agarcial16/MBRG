/**
 * The dev-map 007 layout run shared by the Node tests and the browser console (plan 007 section 12, NFR-44): the 007
 * territory placement once (aspect 3) and the 007 faction placement of seed 1 at rounds 0..T (aspect 4), each state
 * placed from scratch, next to the retained 006 run that `devRun` makes (the "before" of the changed-label list).
 * In a browser: `await import('/test/helpers/centred-digest-run.ts')` from the Vite dev server, then `devCentredDigest()`.
 */
import { factionIndexOf } from '../../src/core/entries';
import { CENTRE_PARAMS } from '../../src/core/centre-params';
import { centredLayoutDigest } from '../../src/core/label-digest';
import { labelTexts } from '../../src/core/label-input';
import type { LabelTexts } from '../../src/core/label-input';
import { placeCentredFactions, placeCentredTerritories } from '../../src/core/label-centred-place';
import type { CentredFactionLayout, CentredTerritoryLayout } from '../../src/core/label-centred-place';
import type { Placed } from '../../src/core/label-offland';
import type { FactionLayout, TerritoryLayout } from '../../src/core/label-place';
import type { PieceIndex } from '../../src/core/regions';
import { LABEL_PARAMS } from '../../src/core/label-params';
import type { InLandFrame } from '../../src/core/label-shape';
import { SHAPE_PARAMS } from '../../src/core/shape-params';
import { DEV_MAP, DEV_PRESENTATION } from './dev-map';
import { devRun } from './label-digest-run';

/** What the 007 placement needs from a 006 run (`devRun` or `measuredRun`): the same state, the retained 006 layouts. */
export interface BaseRun {
  p: PieceIndex;
  texts: LabelTexts;
  factionAspects: Map<number, number>;
  territoryAspects: number[];
  /** Number of rounds T (rounds 0..T exist). */
  rounds: number;
  /** Owner table (faction index per entry) of each round 0..T of seed 1. */
  tables: Uint8Array[];
  /** The retained 006 placement (the "before"). */
  territories: TerritoryLayout;
  factions: FactionLayout[];
}

export interface CentredDevRun extends BaseRun {
  centredTerritories: CentredTerritoryLayout;
  /** Each round placed from that state alone. */
  centredFactions: CentredFactionLayout[];
  centredTerritoryMs: number;
  centredFactionMs: number[];
}

/** The 007 placement of a run: territories once, every round's factions from that state alone, with timings. */
export function withCentred(base: BaseRun): CentredDevRun {
  const t0 = performance.now();
  const centredTerritories = placeCentredTerritories(base.p, base.territoryAspects, LABEL_PARAMS, SHAPE_PARAMS, CENTRE_PARAMS);
  const centredTerritoryMs = performance.now() - t0;
  const centredFactions: CentredFactionLayout[] = [];
  const centredFactionMs: number[] = [];
  for (const owners of base.tables) {
    const t1 = performance.now();
    centredFactions.push(placeCentredFactions(base.p, owners, base.factionAspects, LABEL_PARAMS, SHAPE_PARAMS, CENTRE_PARAMS));
    centredFactionMs.push(performance.now() - t1);
  }
  return { ...base, centredTerritories, centredFactions, centredTerritoryMs, centredFactionMs };
}

/** The injected-aspect dev-map run (territories 3, factions 4) with its 007 placement. */
export async function devCentredRun(): Promise<CentredDevRun> {
  const run = await devRun();
  const texts = labelTexts(DEV_MAP, DEV_PRESENTATION, factionIndexOf(DEV_MAP));
  return withCentred({ ...run, texts });
}

/** The 007 digest of the dev-map placement. */
export async function devCentredDigest(): Promise<string> {
  const run = await devCentredRun();
  return centredLayoutDigest(run.centredTerritories, run.centredFactions);
}

// ---- The changed-label list (plan 007 section 14 U1 and section 15) ----------------------------------------

export type Drawn = InLandFrame | Placed | undefined;

/** A short description of a drawn frame: shape, angle, height. */
export function describeDrawn(f: Drawn): string {
  if (f === undefined) return 'none';
  if (f.shape === 'horizontal') return `horizontal h${String(f.box.h)}`;
  if (f.shape === 'straight') return `straight ${String(f.angle)} h${String(f.h)}`;
  if (f.shape === 'arc') return `arc ${String(f.bend)} h${String(f.h)}`;
  return `off-land h${String(f.box.h)}`;
}

/** Why a label differs: the kind of change from the 006 frame to the 007 frame ('same' when equal). */
export function changeKind(before: Drawn, after: Drawn): string {
  if (JSON.stringify(before) === JSON.stringify(after)) return 'same';
  const a = before?.shape ?? 'none';
  const b = after?.shape ?? 'none';
  if (a !== b) return `${a} -> ${b}`;
  if (before !== undefined && after !== undefined && before.shape === 'straight' && after.shape === 'straight') {
    return before.angle === after.angle ? 'straight, same angle (moved or resized)' : 'straight, angle changed';
  }
  return `${a}, moved or resized`;
}

export interface ChangedLabel {
  role: 'territory' | 'faction';
  /** Round of seed 1 for a faction label; -1 for a territory label. */
  round: number;
  name: string;
  before: string;
  after: string;
  kind: string;
}

/** Every label of the run whose drawn frame differs between the 006 and the 007 placement (territories once, factions per round). */
export function changedLabels(run: CentredDevRun): { changed: ChangedLabel[]; total: number } {
  const changed: ChangedLabel[] = [];
  let total = 0;
  for (let entry = 1; entry < run.p.entries; entry++) {
    if (run.territories.eligible[entry] !== 1) continue;
    total++;
    const before = run.territories.placed[entry] ?? run.territories.inLand[entry];
    const after = run.centredTerritories.placed[entry] ?? run.centredTerritories.inLand[entry];
    const kind = changeKind(before, after);
    if (kind !== 'same') changed.push({ role: 'territory', round: -1, name: run.texts.territories[entry]!, before: describeDrawn(before), after: describeDrawn(after), kind });
  }
  for (let round = 0; round <= run.rounds; round++) {
    const old = run.factions[round]!;
    const now = run.centredFactions[round]!;
    for (const faction of now.boxes.labels.keys()) {
      total++;
      const before = old.placed.get(faction) ?? old.inLand.get(faction);
      const after = now.placed.get(faction) ?? now.inLand.get(faction);
      const kind = changeKind(before, after);
      if (kind !== 'same') changed.push({ role: 'faction', round, name: run.texts.factions.get(faction)!, before: describeDrawn(before), after: describeDrawn(after), kind });
    }
  }
  return { changed, total };
}

/** Count of the changed labels per kind, in first-seen order. */
export function changeCounts(changed: readonly ChangedLabel[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of changed) counts.set(`${c.role}: ${c.kind}`, (counts.get(`${c.role}: ${c.kind}`) ?? 0) + 1);
  return counts;
}
