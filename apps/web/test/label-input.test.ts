import { describe, expect, it } from 'vitest';
import { entryKind } from '@mbrg/shared';
import { getRounds, getState, ownerOf, totalRounds } from '@mbrg/sim';
import { assignFactionColors } from '../src/core/colors';
import { buildEntryIndex, factionIndexOf, ownerTable } from '../src/core/entries';
import { instantLabels, labelsAt } from '../src/core/label-frame';
import { labelTexts, roundLabels } from '../src/core/label-input';
import { factionBoxes, territoryBoxes } from '../src/core/label-layout';
import { LABEL_PARAMS } from '../src/core/label-params';
import { buildPieceIndex } from '../src/core/regions';
import { sceneAt } from '../src/core/scene';
import { stepScenes } from '../src/core/step';
import type { SimPort } from '../src/core/scene';
import { THEME } from '../src/core/theme';
import { devPngBytes, DEV_MAP, DEV_PRESENTATION } from './helpers/dev-map';
import { decodeIdPng } from '../src/core/png';
import { inflateStream } from '../src/ui/load';

// Glue between the scene and the label layer (FR-167, FR-168, FR-174, FR-189): pure, so tested in Node.
const sim: SimPort = { totalRounds, getState, getRounds, ownerOf };

async function setup() {
  const png = await decodeIdPng(devPngBytes(), inflateStream);
  if (!png.ok) throw new Error('png');
  const index = buildEntryIndex(DEV_MAP, png.value.width, png.value.height, png.value.values);
  const colors = assignFactionColors(DEV_MAP, DEV_PRESENTATION, THEME);
  if (!colors.ok) throw new Error('colors');
  const factionIndex = factionIndexOf(DEV_MAP);
  const pieces = buildPieceIndex(index);
  const texts = labelTexts(DEV_MAP, DEV_PRESENTATION, factionIndex);
  const aspects = new Map([...texts.factions.keys()].map((f) => [f, 4] as [number, number]));
  const boxesOfTerritories = territoryBoxes(
    pieces,
    texts.territories.map((t) => (t === undefined ? undefined : 3)),
    LABEL_PARAMS,
  );
  const at = (round: number) => {
    const scene = sceneAt(DEV_MAP, DEV_PRESENTATION, 1, round, sim);
    if (!scene.ok) throw new Error('scene');
    const table = ownerTable(index, scene.value.owners, factionIndex);
    const boxes = factionBoxes(pieces, table, aspects, LABEL_PARAMS);
    return { table, boxes, labels: roundLabels(texts, table, boxes, boxesOfTerritories) };
  };
  return { index, texts, at, boxesOfTerritories, factionIndex };
}

describe('FR-167 FR-168 the label texts are the names of the presentation data', () => {
  it('FR-167 FR-168 one text per land entry (by entry index) and one per faction (by faction index)', async () => {
    const { index, texts, factionIndex } = await setup();
    expect(texts.territories).toHaveLength(index.ids.length);
    expect(texts.territories[0]).toBeUndefined();
    for (let i = 1; i < index.ids.length; i++) {
      const entry = DEV_MAP.territories[i - 1]!;
      const name = DEV_PRESENTATION.territories.find((t) => t.id === entry.id)!.name;
      expect(texts.territories[i], `entry ${i}`).toBe(entryKind(entry) === 'sea' ? undefined : name);
    }
    expect(texts.factions.size).toBe(factionIndex.size);
    for (const [faction, i] of factionIndex) {
      expect(texts.factions.get(i)).toBe(DEV_PRESENTATION.factions.find((f) => f.id === faction)!.name);
    }
  });
});

describe('FR-167 FR-168 FR-174 FR-189 the labels of a round', () => {
  it('FR-167 FR-174 each faction label has its faction name and its box, and no fill', async () => {
    const { at, texts } = await setup();
    const view = at(1);
    expect(view.labels.factions.length).toBe(view.boxes.labels.size);
    for (const label of view.labels.factions) {
      expect(label.text).toBe(texts.factions.get(label.faction));
      expect(label.box).toBe(view.boxes.labels.get(label.faction)!.box);
      expect(label.aspect).toBe(4);
      expect(Object.keys(label).sort()).toStrictEqual(['aspect', 'box', 'faction', 'text']);
    }
  });

  it('FR-168 FR-174 a territory label exists for each owned land entry with a box and no fill key', async () => {
    const { at, texts, boxesOfTerritories } = await setup();
    for (const round of [0, 2, 4]) {
      const view = at(round);
      const expected: number[] = [];
      for (let e = 1; e < view.table.length; e++) {
        if (texts.territories[e] !== undefined && view.table[e]! > 0 && boxesOfTerritories[e] !== undefined) expected.push(e);
      }
      expect(view.labels.territories.map((l) => l.entry), `round ${round}`).toStrictEqual(expected);
      for (const label of view.labels.territories) {
        expect(label.text).toBe(texts.territories[label.entry]);
        expect(label.box).toBe(boxesOfTerritories[label.entry]);
        expect(Object.keys(label).sort()).toStrictEqual(['box', 'entry', 'text']);
      }
    }
  });

  it('FR-171 the territory boxes are the same objects at every round and the labels hold nothing of the owner', async () => {
    const { at } = await setup();
    const a = at(0).labels.territories;
    const b = at(4).labels.territories;
    expect(b.map((l) => l.entry)).toStrictEqual(a.map((l) => l.entry));
    a.forEach((l, i) => expect(b[i]!.box).toBe(l.box));
  });

  it('FR-174 FR-189 roundLabels takes no colours, the same inputs give the same labels, and instantLabels lists factions before territories', async () => {
    const { at } = await setup();
    expect(at(3).labels).toStrictEqual(at(3).labels);
    const drawn = instantLabels(at(3).labels);
    const roles = drawn.map((l) => l.role);
    const firstTerritory = roles.indexOf('territory');
    expect(firstTerritory).toBeGreaterThan(0);
    expect(roles.slice(firstTerritory).every((r) => r === 'territory')).toBe(true);
  });
});

describe('FR-174 FR-181 NFR-33 on the dev map every label is white with a black halo', () => {
  it('FR-174 the labels of rounds 0..4 and of every step between them at several f are all #FFFFFF with a #000000 halo', { timeout: 60_000 }, async () => {
    const { at, index, factionIndex } = await setup();
    let seen = 0;
    const check = (labels: readonly { ink: unknown; halo: unknown; text: string }[], what: string): void => {
      expect(labels.length, what).toBeGreaterThan(0);
      for (const l of labels) {
        expect(l.ink, `${what} ${l.text}`).toStrictEqual([255, 255, 255]);
        expect(l.halo, `${what} ${l.text}`).toStrictEqual([0, 0, 0]);
        seen++;
      }
    };
    for (let round = 0; round < 4; round++) {
      check(instantLabels(at(round).labels), `round ${String(round)}`);
      const from = sceneAt(DEV_MAP, DEV_PRESENTATION, 1, round, sim);
      if (!from.ok) throw new Error('scene');
      const stepped = stepScenes(DEV_MAP, DEV_PRESENTATION, 1, from.value, round + 1, sim);
      if (!stepped.ok) throw new Error('step');
      const transferred = new Set<number>();
      for (const id of stepped.value.data.transferred) transferred.add(index.indexOf.get(id)!);
      expect(transferred.size).toBeGreaterThan(0);
      const input = {
        earlier: at(round).labels,
        later: at(round + 1).labels,
        eliminated: factionIndex.get(stepped.value.data.eliminated)!,
        absorber: factionIndex.get(stepped.value.data.absorber)!,
        transferred,
      };
      for (const f of [0, 0.25, 0.49, 0.5, 0.75, 1]) check(labelsAt(input, f), `step ${String(round)} f ${String(f)}`);
    }
    check(instantLabels(at(4).labels), 'round 4');
    expect(seen).toBeGreaterThan(500);
  });
});

describe('FR-168 FR-170 a territory label needs an owner and a box', () => {
  it('FR-168 FR-170 an entry without owner or without a box has no territory label', async () => {
    const { at, texts, boxesOfTerritories } = await setup();
    const view = at(0);
    const owned = view.labels.territories.map((l) => l.entry);
    const [a, b] = owned as [number, number];
    const table = Array.from(view.table);
    table[a] = 0;
    const withoutBox = boxesOfTerritories.slice();
    withoutBox[b] = undefined;
    const labels = roundLabels(texts, table, view.boxes, withoutBox);
    const entries = labels.territories.map((l) => l.entry);
    expect(entries).not.toContain(a);
    expect(entries).not.toContain(b);
    expect(entries).toHaveLength(owned.length - 2);
  });
});
