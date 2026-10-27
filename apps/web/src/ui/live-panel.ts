// The match screen HUD (spec 010; before it, the live panel of FR-305, NFR-56). Thin: every text comes from the pure modules and the
// strings module, and the layout is chosen by `core/hud-layout`; this file only builds elements, moves two of them between the
// desktop zones and the phone dock, and writes. It shows the round, the phase, the factions alive, the countdown, the victim, the
// winner, the halt reason, the state card, the controls and the legend. No seed, no pointer readout, no timings, no results.
import type { Rgb } from '@mbrg/shared';
import { DOCK_TABS, layoutFor, type DockTab, type Layout } from '../core/hud-layout';
import { cssVariables } from '../core/hud-tokens';
import type { HudState, StateCard, TopBar } from '../core/live-hud';
import { liveTitle, skipLabel } from '../core/live-text';
import type { LivePanelView } from '../core/live-view';
import type { NavAction } from '../core/navigation';
import { STRINGS, fillTemplate } from '../core/strings';
import { PANEL_CSS } from './live-panel-style';

export interface LivePanelHandlers {
  onNavigate(action: NavAction): void;
  onReset(): void;
  /** FR-339: complete the running tour at once. */
  onSkip(): void;
}

/** What the HUD shows besides the panel view: the top bar, the state of the screen and the card of that state. */
export interface HudView {
  readonly bar: TopBar;
  readonly state: HudState;
  readonly card: StateCard | undefined;
}

export interface LivePanel {
  update(view: LivePanelView, hud: HudView): void;
  /** The skip button shows while a tour runs (FR-339). */
  showSkip(visible: boolean): void;
  /** Replaces the address notices (a round above N, an invalid parameter). */
  showMessages(messages: readonly string[]): void;
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
  const alive = el('span', 'hud-alive hud-muted', top);
  const count = el('span', 'hud-count hud-num', top);

  // Left column: the factions. The right column is the leaderboard slot (spec 011) and the minimap zone is spec 010 milestone b.
  const left = zone('left-column', 'hud-left hud-frame', root);
  const legendTitle = el('div', 'hud-title', left);
  legendTitle.textContent = STRINGS.legendTitle;
  const legend = el('ul', 'hud-legend', left);
  const rightColumn = zone('right-column', 'hud-right', root);
  rightColumn.hidden = true;
  const minimap = zone('minimap', 'hud-mini', root);
  minimap.hidden = true;

  // Command panel: victim, winner, halt, notices and the controls.
  const command = zone('command-panel', 'hud-command hud-frame', root);
  el('div', 'hud-title', command).textContent = liveTitle();
  const messages = el('div', 'hud-messages', command);
  messages.setAttribute('role', 'alert');
  const stage = el('div', 'hud-line hud-stage', command);
  const victim = el('div', 'hud-line hud-victim', command);
  const winner = el('div', 'hud-line', command);
  const halt = el('div', 'hud-line hud-alert', command);
  const mismatch = el('div', 'hud-line hud-alert', command);
  const nav = el('div', 'hud-nav', command);
  const first = button(nav, STRINGS.controlFirst, () => handlers.onNavigate('first'));
  const previous = button(nav, STRINGS.controlPrevious, () => handlers.onNavigate('previous'));
  const next = button(nav, STRINGS.controlNext, () => handlers.onNavigate('next'), 'hud-btn primary');
  const last = button(nav, STRINGS.controlLast, () => handlers.onNavigate('last'));
  button(nav, STRINGS.controlReset, handlers.onReset);
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

  /** The command panel and the legend sit in their own zones on the desktop and in the first tab of the dock on a phone. */
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

  return {
    update(view: LivePanelView, hud: HudView): void {
      root.dataset.state = hud.state;
      write(round, hud.bar.round);
      write(phase, hud.bar.phase);
      write(alive, hud.bar.alive === undefined ? undefined : fillTemplate(STRINGS.hudAlive, { count: hud.bar.alive }));
      write(count, hud.bar.countdown);
      write(stage, view.stage);
      write(victim, view.victim);
      write(winner, view.winner);
      write(halt, view.halt);
      write(mismatch, view.mismatch);
      cardTitle.textContent = hud.card?.title ?? '';
      cardText.textContent = hud.card?.text ?? '';
      card.hidden = hud.card === undefined;
      const controls = view.controls;
      first.disabled = controls === undefined || controls.firstDisabled;
      previous.disabled = controls === undefined || controls.previousDisabled;
      next.disabled = controls === undefined || controls.nextDisabled;
      last.disabled = controls === undefined || controls.lastDisabled;
      legend.replaceChildren(
        ...view.legend.map((row) => {
          const item = document.createElement('li');
          const swatch = el('span', 'hud-swatch');
          const rgb = colors.get(row.faction);
          if (rgb !== undefined) swatch.style.background = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
          item.append(swatch, row.text);
          if (!row.alive) item.className = 'out';
          return item;
        }),
      );
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
  };
}
