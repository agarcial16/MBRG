import type { FactionId, MapFormatV1, Ownership, Territory } from '@mbrg/shared';

/** Distinct, pleasant colors assigned to factions in map-territory order. */
export const factionPalette = [
  '#e0a3a8', // salmon
  '#7c7ce0', // periwinkle
  '#e8dc6c', // yellow
  '#5fbf7a', // green
  '#4c9be8', // blue
  '#d87cc0', // pink
  '#e8934c', // orange
  '#4ce0c8', // teal
];

/** Initial owners: every territory starts as its own faction. */
export function initialOwners(map: MapFormatV1): Ownership {
  const owners: Ownership = {};
  for (const t of map.territories) owners[t.id] = t.id;
  return owners;
}

/** One color per initial faction (factions never reappear after dying). */
export function initialColors(map: MapFormatV1): Record<FactionId, string> {
  const colors: Record<FactionId, string> = {};
  map.territories.forEach((t, i) => {
    colors[t.id] = factionPalette[i % factionPalette.length];
  });
  return colors;
}

function territoryCenter(t: Territory): [number, number] {
  if (t.center) return t.center;
  let x = 0;
  let y = 0;
  for (const [px, py] of t.polygon) {
    x += px;
    y += py;
  }
  const n = t.polygon.length || 1;
  return [x / n, y / n];
}

/** Draw the whole map: territories filled by owner color, borders, faction labels. */
export function drawMap(
  canvas: HTMLCanvasElement,
  map: MapFormatV1,
  owners: Ownership,
  colors: Record<FactionId, string>,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  canvas.width = map.width ?? 800;
  canvas.height = map.height ?? 600;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const t of map.territories) {
    const owner = owners[t.id];
    const [first, ...rest] = t.polygon;

    ctx.beginPath();
    ctx.moveTo(first[0], first[1]);
    for (const [x, y] of rest) ctx.lineTo(x, y);
    ctx.closePath();

    ctx.fillStyle = colors[owner] ?? '#888899';
    ctx.fill();
    ctx.strokeStyle = '#17172a';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.stroke();

    const [cx, cy] = territoryCenter(t);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgb(0 0 0 / 60%)';
    ctx.shadowBlur = 4;
    ctx.fillText(owner, cx, cy);
    ctx.shadowBlur = 0;
  }
}
