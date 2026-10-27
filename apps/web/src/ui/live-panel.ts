// The match screen HUD (spec 010; before it, the live panel of FR-305, NFR-56). Thin: every text comes from the pure modules and the
// strings module, and the layout is chosen by `core/hud-layout`; this file only builds elements, moves two of them between the
// desktop zones and the phone dock, and writes. It shows the round, the phase, the factions alive, the countdown, the victim, the
// winner, the halt reason, the state card, the controls, the chronicle, the factions, the replay band, the track of rounds and the
// minimap. No seed, no pointer readout, no timings, no results.
import type { Rgb } from '@mbrg/shared';
import { wheelSteps } from '../core/camera';
import { DOCK_TABS, layoutFor, type DockTab, type Layout } from '../core/hud-layout';
import { cssVariables } from '../core/hud-tokens';
import type { HudState, StateCard, TopBar } from '../core/live-hud';
import { searchRows, sortRows, visibleRows, type ChronicleEntry, type FactionRow, type SortKey } from '../core/live-stats';
import { trackTarget, type ReplayBand, type RoundTrack } from '../core/live-track';
import { liveTitle, skipLabel } from '../core/live-text';
import type { LivePanelView } from '../core/live-view';
import type { UnitRect } from '../core/minimap';
import type { NavAction } from '../core/navigation';
import { STRINGS, fillTemplate } from '../core/strings';
import { PANEL_CSS } from './live-panel-style';

/** How many factions the list shows before "ver todas" (FR-361). */
const LIST_LIMIT = 12;

export interface LivePanelHandlers {
  onNavigate(action: NavAction): void;
  onReset(): void;
  /** FR-339: complete the running tour at once. */
  onSkip(): void;
  /** FR-362: the facts that need the records of the earlier rounds were asked for. */
  onArchive(): void;
  /** FR-359: a point of the minimap (the unit square) was tapped or dragged. */
  onMinimap(point: { x: number; y: number }): void;
  /** The wheel turned over the minimap: zoom the whole map by this many steps. */
  onMinimapZoom(steps: number): void;
}

/** What the HUD shows besides the panel view. */
export interface HudView {
  readonly bar: TopBar;
  readonly state: HudState;
  readonly card: StateCard | undefined;
  /** The "en directo" mark, or none. */
  readonly live: string | undefined;
  readonly band: ReplayBand | undefined;
  readonly track: RoundTrack;
  readonly rows: readonly FactionRow[];
  readonly chronicle: readonly ChronicleEntry[];
}

/** The thumbnail of the minimap: pixels of `width` x `height`, or none to keep the one already drawn. */
export interface MinimapPicture {
  readonly pixels: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

export interface LivePanel {
  update(view: LivePanelView, hud: HudView): void;
  /** The skip button shows while a tour runs (FR-339). */
  showSkip(visible: boolean): void;
  /** Replaces the address notices (a round above N, an invalid parameter). */
  showMessages(messages: readonly string[]): void;
  /** FR-359: the picture (when it changed) and the rectangle of the current view. */
  setMinimap(picture: MinimapPicture | undefined, rect: UnitRect): void;
}

function el(tag: string, className = '', parent?: HTMLElement): HTMLElement {
  const node = document.createElement(tag);
  if (className !== '') node.className = className;
  parent?.append(node);
  return node;
}

function zone(name: string, className: string, parent: HTMLElement): HTMLElement {
  const node = el('div', className, parent);
  node.setAttribute('data-zone', name);
  return node;
}

function button(parent: HTMLElement, label: string, onClick: () => void, className = 'hud-btn'): HTMLButtonElement {
  const node = el('button', className, parent) as HTMLButtonElement;
  node.type = 'button';
  node.textContent = label;
  node.setAttribute('aria-label', label);
  node.addEventListener('click', onClick);
  return node;
}

/** Writes the token variables and the stylesheet once per page. */
function installStyle(): void {
  if (document.getElementById('hud-style') !== null) return;
  const style = document.createElement('style');
  style.id = 'hud-style';
  style.textContent = cssVariables() + PANEL_CSS;
  document.head.append(style);
}

/** The state card of a screen that has nothing else to show yet (the map is not up): loading, an error. */
export function showCard(container: HTMLElement, card: StateCard, working: boolean): void {
  installStyle();
  container.replaceChildren();
  const root = el('div', 'hud');
  root.dataset.state = working ? 'loading' : 'error';
  const box = el('div', 'hud-card hud-frame', root);
  box.setAttribute('role', 'status');
  el('div', 'hud-title', box).textContent = card.title;
  el('p', '', box).textContent = card.text;
  if (working) el('div', 'hud-bar', box).append(document.createElement('i'));
  container.append(root);
}

export function createLivePanel(container: HTMLElement, colors: ReadonlyMap<number, Rgb>, handlers: LivePanelHandlers): LivePanel {
  installStyle();
  container.replaceChildren();
  const root = el('div', 'hud', container);
  let layout: Layout = layoutFor(window.innerWidth);
  root.dataset.layout = layout;

  // Top bar.
  const top = zone('top-bar', 'hud-top hud-frame', root);
  const round = el('span', 'hud-round hud-num', top);
  const phase = el('span', 'hud-phase', top);
  const liveMark = el('span', 'hud-livemark', top);
  const count = el('span', 'hud-count hud-num', top);

  // The band of a replay, under the top bar.
  const bandBox = zone('replay-band', 'hud-band hud-frame', root);
  const bandText = el('span', '', bandBox);
  let bandTarget: NavAction = 'last';
  button(bandBox, STRINGS.hudBackToLive, () => handlers.onNavigate(bandTarget), 'hud-btn primary');
  bandBox.hidden = true;

  // Left column: the chronicle and the factions. The right column is the leaderboard slot (spec 011).
  const left = zone('left-column', 'hud-left hud-frame', root);
  el('div', 'hud-title', left).textContent = STRINGS.hudChronicle;
  const chron = el('ol', 'hud-chron', left);
  const factionsHead = el('div', 'hud-title hud-factions-title', left);
  const sorts = el('div', 'hud-sort', left);
  const sortButtons = new Map<SortKey, HTMLButtonElement>();
  const sortLabels: readonly (readonly [SortKey, string])[] = [
    ['territories', STRINGS.hudSortTerritories],
    ['bajas', STRINGS.hudSortKills],
    ['conq', STRINGS.hudSortConquered],
  ];
  let sortKey: SortKey = 'territories';
  let query = '';
  let showAll = false;
  let last: { view: LivePanelView; hud: HudView } | undefined;
  for (const [key, label] of sortLabels) {
    const chip = button(sorts, label, () => {
      sortKey = key;
      if (key !== 'territories') handlers.onArchive();
      renderFactions();
    }, 'hud-chip');
    sortButtons.set(key, chip);
  }
  const search = el('input', 'hud-search', left) as HTMLInputElement;
  search.type = 'search';
  search.placeholder = STRINGS.hudSearch;
  search.setAttribute('aria-label', STRINGS.hudSearch);
  search.addEventListener('focus', () => handlers.onArchive());
  search.addEventListener('input', () => {
    query = search.value;
    renderFactions();
  });
  const head = el('div', 'hud-row hud-headrow', left);
  for (const label of ['', '', STRINGS.hudColTerritories, STRINGS.hudColKills, STRINGS.hudColConquered]) el('span', '', head).textContent = label;
  const legend = el('ul', 'hud-legend', left);
  const more = button(left, STRINGS.hudShowAll, () => {
    showAll = !showAll;
    renderFactions();
  }, 'hud-btn');
  more.hidden = true;
  const rightColumn = zone('right-column', 'hud-right', root);
  rightColumn.hidden = true;

  // Minimap: a thumbnail of the map in the colours of the owners, and the rectangle of the current view.
  const minimap = zone('minimap', 'hud-mini hud-frame', root);
  minimap.hidden = true;
  el('div', 'hud-title', minimap).textContent = STRINGS.hudMinimap;
  const miniBox = el('div', 'hud-minibox', minimap);
  const miniCanvas = el('canvas', 'hud-minicanvas', miniBox) as HTMLCanvasElement;
  miniCanvas.setAttribute('aria-label', STRINGS.hudMinimapHint);
  miniCanvas.setAttribute('role', 'img');
  const miniRect = el('div', 'hud-minirect', miniBox);
  const pointOf = (event: PointerEvent): { x: number; y: number } => {
    const box = miniCanvas.getBoundingClientRect();
    return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height };
  };
  let dragging = false;
  miniBox.addEventListener('pointerdown', (event) => {
    dragging = true;
    miniBox.setPointerCapture(event.pointerId);
    handlers.onMinimap(pointOf(event));
  });
  miniBox.addEventListener('pointermove', (event) => {
    if (dragging) handlers.onMinimap(pointOf(event));
  });
  miniBox.addEventListener('pointerup', () => {
    dragging = false;
  });
  miniBox.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const steps = wheelSteps(event.deltaY, event.deltaMode);
      if (steps !== 0) handlers.onMinimapZoom(steps);
    },
    { passive: false },
  );

  // Command panel: victim, winner, halt, notices, the track of rounds and the controls.
  const command = zone('command-panel', 'hud-command hud-frame', root);
  el('div', 'hud-title', command).textContent = liveTitle();
  const messages = el('div', 'hud-messages', command);
  messages.setAttribute('role', 'alert');
  const stage = el('div', 'hud-line hud-stage', command);
  const victim = el('div', 'hud-line hud-victim', command);
  const winner = el('div', 'hud-line', command);
  const halt = el('div', 'hud-line hud-alert', command);
  const mismatch = el('div', 'hud-line hud-alert', command);
  const trackBox = el('div', 'hud-track', command);
  const nav = el('div', 'hud-nav', command);
  const first = button(nav, STRINGS.controlFirst, () => handlers.onNavigate('first'), 'hud-btn hud-secondary');
  const previous = button(nav, STRINGS.controlPrevious, () => handlers.onNavigate('previous'));
  const next = button(nav, STRINGS.controlNext, () => handlers.onNavigate('next'), 'hud-btn primary');
  const lastButton = button(nav, STRINGS.controlLast, () => handlers.onNavigate('last'), 'hud-btn hud-secondary');
  button(nav, STRINGS.controlReset, handlers.onReset, 'hud-btn hud-secondary');
  const skip = button(nav, skipLabel(), handlers.onSkip);
  skip.hidden = true;

  // State card: the one polite live region of the screen.
  const card = zone('state-card', 'hud-card hud-frame', root);
  card.setAttribute('role', 'status');
  card.setAttribute('aria-live', 'polite');
  const cardTitle = el('div', 'hud-title', card);
  const cardText = el('p', '', card);
  card.hidden = true;

  // Phone dock: three tabs; the command panel and the legend live in the first one.
  const dock = zone('dock', 'hud-dock hud-frame', root);
  const tabs = el('div', 'hud-tabs', dock);
  tabs.setAttribute('role', 'tablist');
  const panes = new Map<DockTab, HTMLElement>();
  const tabButtons = new Map<DockTab, HTMLElement>();
  let current: DockTab = 'match';
  let open = false;
  root.dataset.dock = 'folded';
  const select = (id: DockTab): void => {
    open = !(id === current && open);
    current = id;
    root.dataset.dock = open ? 'open' : 'folded';
    const shown = open ? current : 'match';
    for (const [tab, node] of tabButtons) node.setAttribute('aria-selected', String(tab === shown));
    for (const [tab, node] of panes) node.hidden = tab !== shown;
  };
  for (const tab of DOCK_TABS) {
    const node = button(tabs, tab.label, () => select(tab.id), 'hud-tab');
    node.setAttribute('role', 'tab');
    tabButtons.set(tab.id, node);
    const pane = el('div', 'hud-pane', dock);
    pane.setAttribute('role', 'tabpanel');
    panes.set(tab.id, pane);
    if (tab.id !== 'match') pane.textContent = STRINGS.hudSoon;
  }
  panes.get('order')!.hidden = true;
  panes.get('ranking')!.hidden = true;
  tabButtons.get('match')!.setAttribute('aria-selected', 'true');

  /** The command panel and the left column sit in their own zones on the desktop and in the first tab of the dock on a phone. */
  const place = (): void => {
    if (layout === 'phone') {
      panes.get('match')?.append(command, left);
    } else {
      root.append(left, command);
    }
  };
  place();
  window.addEventListener('resize', () => {
    const now = layoutFor(window.innerWidth);
    if (now === layout) return;
    layout = now;
    root.dataset.layout = now;
    place();
  });

  const write = (node: HTMLElement, text: string | undefined): void => {
    node.textContent = text ?? '';
    node.hidden = text === undefined;
  };

  const renderChronicle = (entries: readonly ChronicleEntry[]): void => {
    chron.replaceChildren(
      ...entries.map((entry) => {
        const item = document.createElement('li');
        el('b', 'hud-num', item).textContent = String(entry.round);
        const text = el('span', '', item);
        if (entry.status === 'pending') {
          text.textContent = entry.victim === undefined ? STRINGS.hudChronicleRevealing : fillTemplate(STRINGS.hudChroniclePending, { victim: entry.victim });
          item.className = 'pending';
        } else {
          text.textContent = fillTemplate(STRINGS.hudChronicleApplied, { victim: entry.victim, absorber: entry.absorber, count: entry.taken });
        }
        return item;
      }),
    );
  };

  const figure = (value: number | undefined): string => (value === undefined ? STRINGS.hudUnknown : String(value));

  const renderFactions = (): void => {
    if (last === undefined) return;
    const rows = last.hud.rows;
    const total = rows.length;
    const aliveText = fillTemplate(STRINGS.hudAliveOf, { alive: rows.filter((r) => r.alive).length, total });
    factionsHead.textContent = [STRINGS.legendTitle, aliveText].join(' - ');
    for (const [key, chip] of sortButtons) chip.setAttribute('aria-pressed', String(key === sortKey));
    const matched = sortRows(searchRows(rows, query), sortKey);
    const { shown, hidden } = visibleRows(matched, LIST_LIMIT, showAll);
    legend.replaceChildren(
      ...shown.map((row) => {
        const item = el('li', row.alive ? 'hud-row' : 'hud-row out');
        const swatch = el('span', 'hud-swatch', item);
        const rgb = colors.get(row.id);
        if (rgb !== undefined) swatch.style.background = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        const name = el('span', 'hud-name', item);
        el('span', 'hud-n', name).textContent = row.name;
        if (!row.alive) el('small', '', name).textContent = row.fell === undefined ? STRINGS.hudFellUnknown : fillTemplate(STRINGS.hudFell, { round: row.fell });
        el('span', 'hud-fig hud-num', item).textContent = row.alive ? String(row.territories) : STRINGS.hudUnknown;
        el('span', 'hud-fig hud-num', item).textContent = figure(row.bajas);
        el('span', 'hud-fig hud-num', item).textContent = figure(row.conq);
        return item;
      }),
    );
    more.hidden = hidden === 0 && !showAll;
    more.textContent = showAll ? STRINGS.hudShowLess : fillTemplate(STRINGS.hudShowAll, { count: hidden });
    more.setAttribute('aria-label', more.textContent);
  };

  const renderTrack = (track: RoundTrack): void => {
    trackBox.replaceChildren();
    if (track.mode === 'slider') {
      const slider = el('input', 'hud-slider', trackBox) as HTMLInputElement;
      slider.type = 'range';
      slider.min = String(track.min);
      slider.max = String(track.max);
      slider.value = String(track.value);
      slider.setAttribute('aria-label', STRINGS.hudTrack);
      slider.addEventListener('change', () => handlers.onNavigate({ to: Number(slider.value) }));
      return;
    }
    for (const dot of track.items) {
      const target = trackTarget(dot);
      const node = button(trackBox, String(dot.round), () => target !== undefined && handlers.onNavigate(target), `hud-dot ${dot.state}${dot.live ? ' live' : ''}`);
      node.setAttribute('aria-label', fillTemplate(STRINGS.hudTrackRound, { round: dot.round }));
      node.disabled = target === undefined;
      if (dot.state === 'current') node.setAttribute('aria-current', 'true');
    }
  };

  return {
    update(view: LivePanelView, hud: HudView): void {
      last = { view, hud };
      root.dataset.state = hud.state;
      write(round, hud.bar.round);
      write(phase, hud.bar.phase);
      write(liveMark, hud.live);
      write(count, hud.bar.countdown);
      write(stage, view.stage);
      write(victim, view.victim);
      write(winner, view.winner);
      write(halt, view.halt);
      write(mismatch, view.mismatch);
      cardTitle.textContent = hud.card?.title ?? '';
      cardText.textContent = hud.card?.text ?? '';
      card.hidden = hud.card === undefined;
      const band = hud.band;
      bandBox.hidden = band === undefined;
      bandText.textContent = band?.text ?? '';
      if (band !== undefined) bandTarget = band.target;
      const controls = view.controls;
      first.disabled = controls === undefined || controls.firstDisabled;
      previous.disabled = controls === undefined || controls.previousDisabled;
      next.disabled = controls === undefined || controls.nextDisabled;
      lastButton.disabled = controls === undefined || controls.lastDisabled;
      renderChronicle(hud.chronicle);
      renderFactions();
      renderTrack(hud.track);
    },
    showSkip(visible: boolean): void {
      skip.hidden = !visible;
    },
    showMessages(list: readonly string[]): void {
      messages.replaceChildren(
        ...list.map((line) => {
          const row = document.createElement('div');
          row.textContent = line;
          return row;
        }),
      );
    },
    setMinimap(picture: MinimapPicture | undefined, rect: UnitRect): void {
      minimap.hidden = false;
      if (picture !== undefined) {
        miniCanvas.width = picture.width;
        miniCanvas.height = picture.height;
        const context = miniCanvas.getContext('2d');
        const data = new ImageData(new Uint8ClampedArray(picture.pixels), picture.width, picture.height);
        context?.putImageData(data, 0, 0);
      }
      miniRect.style.left = `${rect.x * 100}%`;
      miniRect.style.top = `${rect.y * 100}%`;
      miniRect.style.width = `${rect.w * 100}%`;
      miniRect.style.height = `${rect.h * 100}%`;
    },
  };
}
