import { describe, expect, it } from 'vitest';
import { buildEntryIndex } from '../src/core/entries';
import { THEME, toMapTheme } from '../src/core/theme';
import { createMapScene } from '../src/render/map-scene';
import { DEV_MAP } from './helpers/dev-map';
import { FRAGMENT_SHADER } from '../src/render/shader';
import { TOKENS } from '../src/core/hud-tokens';
import { PICK_CLASSES, PICK_GILT, pickedColor, pickedOf } from '../src/core/pick-outline';

const BASE = [10, 20, 30] as const;
const smallIndex = (): ReturnType<typeof buildEntryIndex> => buildEntryIndex(DEV_MAP, 3, 2, [0, DEV_MAP.territories[0]!.id, DEV_MAP.territories[1]!.id, DEV_MAP.territories[2]!.id, DEV_MAP.territories[0]!.id, 0]);

describe('the chosen faction is outlined in gilt on the map (design of spec 013)', () => {
  it('the gilt is the gilt of the HUD tokens', () => {
    const hex = TOKENS.gilt;
    const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    expect([...PICK_GILT]).toStrictEqual(rgb);
  });

  it('a border pixel on the chosen faction side takes the gilt', () => {
    for (const border of PICK_CLASSES) expect(pickedColor([...BASE], border, 7, 7)).toStrictEqual([...PICK_GILT]);
  });

  it('the other side of the border, other factions, inner territory lines and no choice keep the colour', () => {
    expect(pickedColor([...BASE], 'faction', 8, 7)).toStrictEqual([...BASE]);
    expect(pickedColor([...BASE], 'territory', 7, 7)).toStrictEqual([...BASE]);
    expect(pickedColor([...BASE], 'sea-zone', 7, 7)).toStrictEqual([...BASE]);
    expect(pickedColor([...BASE], null, 7, 7)).toStrictEqual([...BASE]);
    expect(pickedColor([...BASE], 'faction', 7, 0)).toStrictEqual([...BASE]);
    expect(pickedColor([...BASE], 'faction', 0, 0)).toStrictEqual([...BASE]);
  });

  it('the shader ports the rule from the same class list', () => {
    expect(FRAGMENT_SHADER).toContain('uPick');
    expect(FRAGMENT_SHADER).toContain('uPickColor');
    for (const c of PICK_CLASSES) expect(FRAGMENT_SHADER).toContain(`border == C_${c.toUpperCase().replace('-', '_')}`);
    expect(FRAGMENT_SHADER).not.toContain('border == C_TERRITORY && unitOwner == uPick');
  });

  it('the outlined faction is the one marked as sent among the choices, or none', () => {
    expect(pickedOf([{ faction: 4, selected: false }, { faction: 9, selected: true }])).toBe(9);
    expect(pickedOf([{ faction: 4, selected: false }])).toBeUndefined();
    expect(pickedOf(undefined)).toBeUndefined();
  });

  it('the scene takes the faction index of the outline as one uniform and refuses a non-byte', () => {
    const scene = createMapScene(smallIndex(), [[0, 0, 0], [1, 2, 3]], toMapTheme(THEME));
    scene.setPick(1);
    expect(scene.material.uniforms.uPick!.value).toBe(1);
    scene.setPick(undefined);
    expect(scene.material.uniforms.uPick!.value).toBe(0);
    expect(() => scene.setPick(256)).toThrow(RangeError);
    expect(() => scene.setPick(1.5)).toThrow(RangeError);
  });
});
