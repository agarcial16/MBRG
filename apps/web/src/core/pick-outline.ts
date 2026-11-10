// The chosen faction is outlined in white on the map (spec 013 design, amended 2026-11-10: gilt was easy to confuse with the ochre and yellow factions). `pickedColor` is the normative rule the GLSL of `render/shader`
// ports: a pixel of the chosen faction's own side of a faction, coast or outer line takes the white. Pure; no colour decision elsewhere.
import type { Rgb } from '@mbrg/shared';
import type { BorderClass } from './theme';

/** The colour of the outline: white. */
export const PICK_WHITE: Rgb = [255, 255, 255];

/** The lines that make the perimeter of a faction: against another faction, against the sea, against the outside. */
export const PICK_CLASSES: readonly BorderClass[] = ['faction', 'coast', 'outer'];

/** How far inside the perimeter the white reaches, in screen (CSS) pixels: the band is much wider than the 1 to 2 px line under it. */
export const PICK_REACH = 3;

/** The colour of a pixel of the owner `unitOwner` on a line of class `border`, when faction index `picked` (0 = none) is chosen. */
export function pickedColor(base: Rgb, border: BorderClass | null, unitOwner: number, picked: number): Rgb {
  if (picked === 0 || unitOwner !== picked || border === null || !PICK_CLASSES.includes(border)) return base;
  return PICK_WHITE;
}

/** The faction id the player has chosen among the choices on offer, or none. */
export function pickedOf(choices: readonly { readonly faction: number; readonly selected: boolean }[] | undefined): number | undefined {
  return choices?.find((c) => c.selected)?.faction;
}
