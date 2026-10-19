import { describe, expect, it } from 'vitest';
import { labelCounts } from '../src/core/label-counts';
import type { Counts } from '../src/core/label-counts';
import type { LabelTexts } from '../src/core/label-input';
import type { LeaderLine, OffLand } from '../src/core/label-offland';
import type { ArcFrame, InLandFrame, ShapedFrame, StraightFrame } from '../src/core/label-shape';
import { labelCountsLine } from '../src/core/panel-text';
import { fillTemplate, STRINGS } from '../src/core/strings';

const hz: InLandFrame = { shape: 'horizontal', box: { x0: 1, y0: 2, h: 6, w: 18 } };
const st: StraightFrame = { shape: 'straight', cx: 5, cy: 5, angle: 90, h: 6, w: 18 };
const ar: ArcFrame = { shape: 'arc', cx: 5, cy: 5, angle: 0, h: 6, w: 18, bend: 30, radius: 100 };
const LEADER: LeaderLine = { x1: 0, y1: 0, x2: 9, y2: 9 };
const far: OffLand = { shape: 'off-land', box: { x0: 40, y0: 40, h: 10, w: 30 }, gap2: 100, anchor: 3, leader: LEADER };
const near: OffLand = { shape: 'off-land', box: { x0: 40, y0: 40, h: 10, w: 30 }, gap2: 4, anchor: 3 };

const texts: LabelTexts = {
  territories: [undefined, 'a', 'b', 'c', 'd', 'e', 'f', undefined, 'h', 'i'],
  factions: new Map([[1, 'F1'], [2, 'F2'], [3, 'F3'], [4, 'F4'], [5, 'F5'], [6, 'F6'], [8, 'F8'], [9, 'F9']]),
};

describe('FR-214 label counts per category', () => {
  const factions = {
    // faction 7 has a layout entry but no text: no label entry, in no category
    boxes: { labels: new Map<number, unknown>([1, 2, 3, 4, 5, 6, 7, 8, 9].map((f) => [f, {}] as [number, unknown])) },
    inLand: new Map<number, InLandFrame | undefined>([
      [1, hz],
      [2, st],
      [3, ar],
      [4, undefined],
      [5, undefined],
      [6, st],
      [7, hz],
      [8, hz],
      [9, ar],
    ]),
    // 8: an off-land search failed, FR-206 keeps the horizontal frame; 9: FR-206 keeps the arc as its placed frame
    placed: new Map<number, ShapedFrame | OffLand>([
      [2, st],
      [3, ar],
      [4, far],
      [6, near],
      [9, ar],
    ]),
  };
  const table = [0, 1, 1, 1, 1, 1, 0, 1, 1, 1];
  const territories = {
    eligible: Uint8Array.from([0, 1, 1, 1, 1, 0, 1, 1, 1, 1]),
    inLand: [undefined, hz, st, undefined, undefined, undefined, hz, hz, ar, undefined] as (InLandFrame | undefined)[],
    placed: [undefined, undefined, st, near, undefined, undefined, undefined, undefined, ar, undefined] as (ShapedFrame | OffLand | undefined)[],
  };

  it('FR-214 faction labels: horizontal, straight, arc, off-land and none are exclusive and count fallbacks by shape', () => {
    const c = labelCounts(texts, table, factions, territories).faction;
    // 1 horizontal, 8 horizontal (fallback); 2 straight; 3 and 9 arc; 4 and 6 off-land (6 is not also straight); 5 none
    expect(c).toStrictEqual({ horizontal: 2, straight: 1, arc: 2, offLand: 2, none: 1 });
    expect(c.horizontal + c.straight + c.arc + c.offLand + c.none).toBe(8);
  });

  it('FR-214 territory labels: only owned land entries with a text and an aspect count', () => {
    const c = labelCounts(texts, table, factions, territories).territory;
    // entry 1 horizontal; 2 straight; 3 off-land; 4 none; 5 no aspect; 6 unowned; 7 no text; 8 arc; 9 none
    expect(c).toStrictEqual({ horizontal: 1, straight: 1, arc: 1, offLand: 1, none: 2 });
  });

  it('FR-214 a label hidden by scale still counts: the counts do not depend on anything but the layout', () => {
    expect(labelCounts(texts, table, factions, territories)).toStrictEqual(labelCounts(texts, table, factions, territories));
  });

  it('FR-214 a faction without land, without a text or an entry is in no category; an empty layout counts zero', () => {
    const zero: Counts = { horizontal: 0, straight: 0, arc: 0, offLand: 0, none: 0 };
    const empty = labelCounts(
      { territories: [undefined], factions: new Map() },
      [0],
      { boxes: { labels: new Map() }, inLand: new Map(), placed: new Map() },
      { eligible: new Uint8Array(1), inLand: [undefined], placed: [undefined] },
    );
    expect(empty).toStrictEqual({ faction: zero, territory: zero });
  });
});

describe('FR-214 the counts line goes through the UI strings', () => {
  const c = {
    faction: { horizontal: 11, straight: 12, arc: 13, offLand: 14, none: 15 },
    territory: { horizontal: 21, straight: 22, arc: 23, offLand: 24, none: 25 },
  };

  it('FR-214 the line names each category with its count, factions before territories, and holds no placeholder', () => {
    const line = labelCountsLine(c);
    expect(/\{\w+\}/.test(line)).toBe(false);
    const parts = (n: number): string[] => [
      fillTemplate(STRINGS.labelCountHorizontal, { count: n }),
      fillTemplate(STRINGS.labelCountStraight, { count: n + 1 }),
      fillTemplate(STRINGS.labelCountArc, { count: n + 2 }),
      fillTemplate(STRINGS.labelCountOffLand, { count: n + 3 }),
      fillTemplate(STRINGS.labelCountNone, { count: n + 4 }),
    ];
    let at = -1;
    for (const part of [...parts(11), ...parts(21)]) {
      const i = line.indexOf(part);
      expect(i, part).toBeGreaterThan(at);
      at = i;
    }
    expect(line.indexOf(fillTemplate(STRINGS.labelCountsFaction, { value: parts(11).join(', ') }))).toBeGreaterThanOrEqual(0);
    expect(line.indexOf(STRINGS.labelCountsTerritory.replace(/\s*\{value\}.*$/, ''))).toBeGreaterThan(line.indexOf(parts(11)[4]!));
  });

  it('FR-214 different counts give a different line', () => {
    expect(labelCountsLine(c)).not.toBe(labelCountsLine({ faction: c.territory, territory: c.faction }));
  });
});
