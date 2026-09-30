import type { FactionId, MatchState, Ownership, RoundEvent } from '@mbrg/shared';

function dot(color: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = 'dot';
  el.style.background = color;
  return el;
}

export interface StatsView {
  owners: Ownership;
  colors: Record<FactionId, string>;
  total: number;
  winner: FactionId | null;
  /** Rounds revealed so far — kills/captures are computed from these only. */
  events: RoundEvent[];
}

/** Top of a counter map: comma-joined names (alphabetical) + max value. */
function leaders(counts: Map<FactionId, number>): { names: string; value: number } | null {
  if (counts.size === 0) return null;
  let max = 0;
  for (const v of counts.values()) if (v > max) max = v;
  const names = [...counts.entries()]
    .filter(([, v]) => v === max)
    .map(([id]) => id)
    .sort()
    .join(', ');
  return { names, value: max };
}

function duringRow(emoji: string, label: string, names: string, count: string): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'during-row';
  const strong = document.createElement('strong');
  strong.textContent = names;
  row.append(`${emoji} ${label} `, strong, ` ${count}`);
  return row;
}

/**
 * Power ranking: provinces per living faction (sorted by size), bars relative
 * to the total territory count, a winner banner when the match is over, and a
 * live "Durante la partida" block (top killer / top capturer).
 */
export function renderStats(container: HTMLElement, view: StatsView): void {
  const { owners, colors, total, winner, events } = view;
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

  // Live summary of the match so far (one kill + N captured provinces per round).
  if (events.length > 0) {
    const kills = new Map<FactionId, number>();
    const captured = new Map<FactionId, number>();
    for (const event of events) {
      kills.set(event.annexer, (kills.get(event.annexer) ?? 0) + 1);
      captured.set(event.annexer, (captured.get(event.annexer) ?? 0) + event.gained.length);
    }
    const topKiller = leaders(kills);
    const topCapturer = leaders(captured);

    const box = document.createElement('div');
    box.className = 'during';
    const title = document.createElement('div');
    title.className = 'during-title';
    title.textContent = 'Durante la partida';
    box.append(title);
    if (topKiller) {
      box.append(duringRow('⚔️', 'Mayor asesino:', topKiller.names, `(${topKiller.value})`));
    }
    if (topCapturer) {
      box.append(duringRow('🚩', 'Más capturas:', topCapturer.names, `(+${topCapturer.value})`));
    }
    container.append(box);
  }
}

/** Convenience: slice the revealed rounds of a match. */
export function revealedEvents(match: MatchState, current: number): RoundEvent[] {
  return match.log.slice(0, current);
}
