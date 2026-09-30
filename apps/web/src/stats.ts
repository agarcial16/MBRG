import type { FactionId, Ownership } from '@mbrg/shared';

function dot(color: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = 'dot';
  el.style.background = color;
  return el;
}

/**
 * Power ranking: provinces per living faction (sorted by size), bars relative
 * to the total territory count, plus a winner banner when the match is over.
 */
export function renderStats(
  container: HTMLElement,
  owners: Ownership,
  colors: Record<FactionId, string>,
  total: number,
  winner: FactionId | null,
): void {
  container.textContent = '';

  const counts = new Map<FactionId, number>();
  for (const faction of Object.values(owners)) {
    counts.set(faction, (counts.get(faction) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );

  if (winner) {
    const banner = document.createElement('div');
    banner.className = 'winner';
    banner.textContent = `🏆 ${winner} gana la partida`;
    container.append(banner);
  }

  for (const [id, count] of ranked) {
    const row = document.createElement('div');
    row.className = 'stat-row';

    const label = document.createElement('span');
    label.className = 'name';
    label.textContent = id;

    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('div');
    fill.className = 'fill';
    fill.style.width = `${Math.round((count / total) * 100)}%`;
    fill.style.background = colors[id] ?? '#888899';
    bar.append(fill);

    const countEl = document.createElement('span');
    countEl.className = 'count';
    countEl.textContent = `${count}/${total}`;

    row.append(dot(colors[id] ?? '#888899'), label, bar, countEl);
    container.append(row);
  }
}
