import type { FactionId, MatchState } from '@mbrg/shared';

function dot(color: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = 'dot';
  el.style.background = color;
  return el;
}

function name(faction: FactionId): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = 'name';
  el.textContent = faction;
  return el;
}

/**
 * Event log: reveals only rounds up to `current` (the round-by-round reveal
 * model — future rounds are never shown before they happen).
 */
export function renderLog(
  container: HTMLOListElement,
  match: MatchState,
  current: number,
  colors: Record<FactionId, string>,
): void {
  const entries = match.log.slice(0, current);
  container.textContent = '';

  if (entries.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'Sin eventos todavía — pulsa ▶';
    container.append(empty);
    return;
  }

  for (const event of entries) {
    const li = document.createElement('li');

    const round = document.createElement('span');
    round.className = 'round';
    round.textContent = `R${event.round}`;

    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.textContent = '→';

    const gained = document.createElement('span');
    gained.className = 'gained';
    gained.textContent = `+${event.gained.length}`;

    li.append(
      round,
      dot(colors[event.eliminated] ?? '#888899'),
      name(event.eliminated),
      arrow,
      dot(colors[event.annexer] ?? '#888899'),
      name(event.annexer),
      gained,
    );
    container.append(li);
  }

  container.scrollTop = container.scrollHeight;
}
