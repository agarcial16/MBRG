/** The number of colors of the builder's fixed preview palette (`core/preview.ts`): beyond it the builder falls back to near-black. */
const PALETTE_SIZE = 16;

/** One hue step of the golden angle, in degrees: neighbouring indexes land far apart on the color wheel. */
const GOLDEN_ANGLE = 137.508;

/** `#rrggbb` of a color given by hue (degrees), saturation and lightness (0 to 1). */
function hsl(hue: number, saturation: number, lightness: number): string {
  const a = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n: number): string => {
    const k = (n + hue / 30) % 12;
    const value = lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/**
 * FR-610: the factions of a preview with a color for every faction beyond the builder's 16-color palette, which would
 * otherwise draw all of them in `#000001`, `#000002` and so on (near-black). Given colors stay; the first 16 uncolored
 * factions are left to the builder's palette; each later one gets a color on a golden-angle walk of the hue wheel at
 * middling lightness, skipping any color already taken, so all stay distinct. Pure: the same factions give the same colors.
 */
export function withPreviewColors(factions: readonly { id: number; color?: string }[]): { id: number; color?: string }[] {
  const taken = new Set(factions.flatMap((f) => (f.color === undefined ? [] : [f.color])));
  let uncolored = 0;
  let step = 0;
  return factions.map((f) => {
    if (f.color !== undefined) return f;
    if (uncolored++ < PALETTE_SIZE) return f;
    let color = hsl((step * GOLDEN_ANGLE) % 360, 0.65 + 0.2 * (step % 2), 0.5 + 0.1 * (step % 3));
    step++;
    while (taken.has(color)) {
      color = hsl((step * GOLDEN_ANGLE) % 360, 0.65 + 0.2 * (step % 2), 0.5 + 0.1 * (step % 3));
      step++;
    }
    taken.add(color);
    return { id: f.id, color };
  });
}
