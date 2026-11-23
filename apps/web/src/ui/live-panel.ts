// The match screen HUD (spec 010; before it, the live panel of FR-305, NFR-56). Thin: every text comes from the pure modules and the
// strings module, and the layout is chosen by `core/hud-layout`; this file only builds elements, moves two of them between the
// desktop zones and the phone dock, and writes. It shows the round, the phase, the factions alive, the countdown, the victim, the
// winner, the halt reason, the state card, the controls, the chronicle, the factions, the replay band, the track of rounds and the
// minimap. No seed, no pointer readout, no timings, no results.
import type { Rgb } from '@mbrg/shared';
import { wheelSteps } from '../core/camera';
import { pinchDistance } from '../core/pinch';
import { dockHandle, dockPress, dockStart, dockStep, dockTabs, type DockState } from '../core/dock';
import { DOCK_TABS, dockHeight, dockPaneHeight, layoutFor, type DockTab, type Layout } from '../core/hud-layout';
import { cssVariables } from '../core/hud-tokens';
import type { HudState, StateCard, TopBar } from '../core/live-hud';
import { searchRows, sortRows, territoryShare, totalTerritories, visibleRows, type ChronicleEntry, type FactionRow, type SortKey } from '../core/live-stats';
import {
  TRACK_METRICS,
  parseJumpRound,
  roundWindow,
  sanitizeJumpInput,
  shiftWindow,
  swipeShift,
  trackTarget,
  windowCapacity,
  windowPageStep,
  type ReplayBand,
  type RoundTrack,
} from '../core/live-track';
import { liveTitle, skipLabel } from '../core/live-text';
import type { LivePanelView } from '../core/live-view';
import type { UnitRect } from '../core/minimap';
import type { NavAction } from '../core/navigation';
import type { PlayHud, PredictView, WinnersLine } from '../core/play-view';
import type { ResultView } from '../core/results-model';
import type { BoardView } from '../core/board-model';
import type { ScreenRect } from '../core/reveal-camera';
import { createBoardPanel, type BoardPanel } from './board-panel';
import { buildBrandLogo } from './brand-logo-svg';
import { STRINGS, fillTemplate } from '../core/strings';
import type { BannerView } from '../core/round-banner';
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
  /** FR-412: two fingers on the minimap moved apart (ratio above 1) or together; the new distance over the old. */
  onMinimapPinch(ratio: number): void;
  /** FR-408: a tap or a key on the round banner. */
  onBannerDismiss(): void;
  /** FR-443: the phone dock folded or unfolded (called with every repaint of the dock, also at the start); the map area follows it. */
  onDock?(folded: boolean): void;
  /** The player's controls (spec 013); absent when the page has no player session. */
  readonly play?: PlayHandlers;
}

/** The player's controls on the match screen (spec 013 FR-401, FR-406, FR-407). */
export interface PlayHandlers {
  /** FR-401: a faction of the HUD bar was chosen; it is sent at once. */
  onPick(faction: number): void;
  /** Spec 019: the board list shows rows up to this index; a search text; the buttons of the board; the focus moved to the jump row. */
  onBoardWant(last: number): void;
  onBoardQuery(text: string): void;
  onBoardMine(): void;
  onBoardCancel(): void;
  onBoardRetry(): void;
  onBoardJumped(): void;
  onWinnersToggle(key: string): void;
  onWinnersPage(key: string, delta: number): void;
  /** FR-397: fills the box of the personal link (once, when the player chip is first opened). */
  fillPersonal(parent: HTMLElement): void;
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
  /** FR-439: a victim reveal, a finalised beat or an absorber animation is on screen (the phone dock folds). */
  readonly hold?: boolean;
  readonly rows: readonly FactionRow[];
  readonly chronicle: readonly ChronicleEntry[];
  /** The records of played rounds are still being read (a match opened late): the empty chronicle says so instead of "none has fallen". */
  readonly chronicleLoading?: boolean;
  /** FR-408: the round banner on screen, or none. */
  readonly banner?: BannerView;
  /** Spec 031: swatch colour of the announced round target (only when publicly revealed, never during a tour). */
  readonly targetColor?: Rgb;
  /** FR-409: "PREDICCIONES FINALIZADAS" or "REVELANDO...", or none. */
  readonly overlay?: string;
  /** What the player sees besides the spectator screen (spec 013); absent without a player session. */
  readonly play?: PlayHud;
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
  /** Spec 031: screen rectangle of the visible reveal duel callout (relative to the viewport), or undefined when hidden. */
  calloutRect(): ScreenRect | undefined;
  /** Spec 031: unobstructed map area inside the HUD chrome (relative to the viewport). */
  mapAreaRect(): ScreenRect;
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

/** A control with a short face that fits one row; the full words are its accessible name and its tooltip. */
function navButton(parent: HTMLElement, full: string, short: string, onClick: () => void, className: string): HTMLButtonElement {
  const node = button(parent, short, onClick, className);
  node.setAttribute('aria-label', full);
  node.title = full;
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
export function showCard(container: HTMLElement, card: StateCard, working: boolean): HTMLElement {
  installStyle();
  container.replaceChildren();
  const root = el('div', 'hud');
  root.dataset.state = working ? 'loading' : 'error';
  root.dataset.layout = layoutFor(window.innerWidth);
  const box = el('div', 'hud-card hud-frame', root);
  box.setAttribute('role', 'status');
  el('div', 'hud-title', box).textContent = card.title;
  el('p', '', box).textContent = card.text;
  if (working) el('div', 'hud-bar', box).append(document.createElement('i'));
  container.append(root);
  return box;
}

export function createLivePanel(container: HTMLElement, colors: ReadonlyMap<number, Rgb>, handlers: LivePanelHandlers): LivePanel {
  installStyle();
  container.replaceChildren();
  const root = el('div', 'hud', container);
  let layout: Layout = layoutFor(window.innerWidth);
  root.dataset.layout = layout;
  // FR-445: the height of the open dock follows the screen; the custom properties are the figures of dockHeight/dockPaneHeight.
  const sizeDock = (): void => {
    root.style.setProperty('--hud-pane-h', `${dockPaneHeight(window.innerHeight)}px`);
    root.style.setProperty('--hud-open-h', `${dockHeight(window.innerHeight, false)}px`);
  };
  sizeDock();

  // Top bar (spec 031: slim 52 px refined cartographic brass bar on desktop).
  const top = zone('top-bar', 'hud-top hud-frame', root);
  const brand = el('span', 'hud-brand', top);
  const logo = buildBrandLogo('hud-brand-logo');
  brand.append(logo);
  el('span', 'hud-brand-name', brand).textContent = STRINGS.hudBrand;
  const round = el('span', 'hud-round hud-num', top);
  const phase = el('span', 'hud-phase', top);
  const liveMark = el('span', 'hud-livemark', top);
  const count = el('span', 'hud-count hud-num', top);
  // The player chip (FR-406) opens the personal link (FR-397).
  const chipButton = button(top, '', () => {
    personal.hidden = !personal.hidden;
    if (!personal.hidden && !personalFilled) {
      personalFilled = true;
      handlers.play?.fillPersonal(personal);
    }
  }, 'hud-playerchip');
  chipButton.hidden = true;
  const chipName = el('span', 'hud-chip-name', chipButton);
  const chipStats = el('span', 'hud-chip-stats', chipButton);

  // Spec 031: floating pill at upper-centre on desktop for the announced round target (anti-spoiler: reuses `victim` element).
  const pillBox = zone('target-pill', 'hud-pill hud-frame', root);
  pillBox.hidden = true;
  const pillSwatch = el('span', 'hud-swatch hud-pill-swatch', pillBox);
  pillSwatch.hidden = true;

  // The band of a replay, under the top bar.
  const bandBox = zone('replay-band', 'hud-band hud-frame', root);
  const bandText = el('span', '', bandBox);
  let bandTarget: NavAction = 'last';
  button(bandBox, STRINGS.hudBackToLive, () => handlers.onNavigate(bandTarget), 'hud-btn primary');
  bandBox.hidden = true;

  // Left column: the chronicle and the factions. On the phone each section is the content of its own dock tab (FR-440).
  // The right column is the leaderboard slot (spec 011).
  const left = zone('left-column', 'hud-left hud-frame', root);
  const chronSection = el('div', 'hud-section hud-chron-section', left);
  el('div', 'hud-title hud-chron-title', chronSection).textContent = STRINGS.hudChronicle;
  const chronEmpty = el('p', 'hud-note', chronSection);
  chronEmpty.textContent = STRINGS.hudChronicleEmpty;
  const chron = el('ol', 'hud-chron', chronSection);
  const factionsSection = el('div', 'hud-section hud-factions-section', left);
  const factionsHead = el('div', 'hud-title hud-factions-title', factionsSection);
  const sorts = el('div', 'hud-sort', factionsSection);
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
  const search = el('input', 'hud-search', factionsSection) as HTMLInputElement;
  search.type = 'search';
  search.placeholder = STRINGS.hudSearch;
  search.setAttribute('aria-label', STRINGS.hudSearch);
  search.addEventListener('focus', () => handlers.onArchive());
  search.addEventListener('input', () => {
    query = search.value;
    renderFactions();
  });
  const head = el('div', 'hud-row hud-headrow', factionsSection);
  for (const label of ['', '', STRINGS.hudColTerritories, STRINGS.hudColKills, STRINGS.hudColConquered]) el('span', '', head).textContent = label;
  const legend = el('ul', 'hud-legend', factionsSection);
  const more = button(factionsSection, STRINGS.hudShowAll, () => {
    showAll = !showAll;
    renderFactions();
  }, 'hud-btn hud-more');
  more.hidden = true;
  const rightColumn = zone('right-column', 'hud-right hud-frame', root);
  rightColumn.hidden = true;
  const personal = zone('personal', 'hud-pop hud-frame', root);
  personal.hidden = true;
  let personalFilled = false;
  let hasBoard = false;

  // Minimap: compact headerless thumbnail docked in the bottom-right corner (spec 031: "Carta general" header removed).
  const minimap = zone('minimap', 'hud-mini hud-frame', root);
  minimap.hidden = true;
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
  // FR-412: the touches on the minimap; two of them pinch the main camera instead of moving it.
  const touches = new Map<number, { x: number; y: number }>();
  const gap = (): number | undefined => {
    const [a, b] = [...touches.values()];
    return a === undefined || b === undefined || touches.size !== 2 ? undefined : pinchDistance(a, b);
  };
  miniBox.addEventListener('pointerdown', (event) => {
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    dragging = touches.size === 1;
    try {
      miniBox.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that is no longer active (a synthetic or just-lifted one) cannot be captured; the drag still works from the box.
    }
    if (dragging) handlers.onMinimap(pointOf(event));
  });
  miniBox.addEventListener('pointermove', (event) => {
    if (!touches.has(event.pointerId)) return;
    const before = gap();
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const after = gap();
    if (before !== undefined && after !== undefined && before > 0) handlers.onMinimapPinch(after / before);
    else if (dragging) handlers.onMinimap(pointOf(event));
  });
  const lift = (event: PointerEvent): void => {
    touches.delete(event.pointerId);
    dragging = false;
  };
  miniBox.addEventListener('pointerup', lift);
  miniBox.addEventListener('pointercancel', lift);
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
  const predictBox = el('div', 'hud-predict', command);
  predictBox.hidden = true;
  const resultBox = el('div', 'hud-result', command);
  resultBox.hidden = true;
  const stage = el('div', 'hud-line hud-stage', command);
  const victim = el('div', 'hud-line hud-victim', command);
  const winner = el('div', 'hud-line', command);
  const halt = el('div', 'hud-line hud-alert', command);
  const mismatch = el('div', 'hud-line hud-alert', command);
  // The round controls: the selector of rounds and the buttons. On the desk they are the bottom row of this panel; on the phone they
  // are the strip of the dock, always visible with the dock open, on every tab (FR-441, spec 034 FR-660..FR-666).
  const controls = el('div', 'hud-controls', command);
  const roundSel = el('div', 'hud-roundsel', controls);
  roundSel.setAttribute('role', 'group');
  roundSel.setAttribute('aria-label', STRINGS.hudTrack);
  let lastTrack: RoundTrack | undefined;
  let lastWindowOffset: number | undefined;
  let lastDisplayed: number | undefined;
  let lastApplied: number | undefined;
  let lastCapacity = 1;
  let lastWindowCount = 0;
  let lastMaxJump = 0;
  let jumpEditing = false;

  const trackLabel = button(roundSel, '', () => openJump(), 'hud-track-label hud-num');
  const jumpInput = el('input', 'hud-jump-input hud-num', roundSel) as HTMLInputElement;
  jumpInput.type = 'text';
  jumpInput.inputMode = 'numeric';
  jumpInput.pattern = '[0-9]*';
  jumpInput.hidden = true;
  const startDot = button(roundSel, STRINGS.hudTrackStart, () => handlers.onNavigate({ to: 0 }), 'hud-dot start');
  startDot.setAttribute('aria-label', STRINGS.hudTrackStart);
  const pagerPrev = navButton(roundSel, STRINGS.hudTrackWindowPrev, STRINGS.hudTrackWindowPrevShort, () => shiftBy(-windowPageStep(lastCapacity)), 'hud-track-pager');
  const trackBox = el('div', 'hud-track', roundSel);
  const pagerNext = navButton(roundSel, STRINGS.hudTrackWindowNext, STRINGS.hudTrackWindowNextShort, () => shiftBy(windowPageStep(lastCapacity)), 'hud-track-pager');
  const nav = el('div', 'hud-nav', controls);
  const first = navButton(nav, STRINGS.controlFirst, STRINGS.controlFirstShort, () => handlers.onNavigate('first'), 'hud-btn hud-secondary hud-nav-btn');
  const previous = navButton(nav, STRINGS.controlPrevious, STRINGS.controlPreviousShort, () => handlers.onNavigate('previous'), 'hud-btn hud-nav-btn');
  const next = navButton(nav, STRINGS.controlNext, STRINGS.controlNextShort, () => handlers.onNavigate('next'), 'hud-btn primary hud-nav-btn');
  const lastButton = navButton(nav, STRINGS.controlLast, STRINGS.controlLastShort, () => handlers.onNavigate('last'), 'hud-btn hud-secondary hud-nav-btn');
  navButton(nav, STRINGS.controlReset, STRINGS.controlResetShort, handlers.onReset, 'hud-btn hud-secondary hud-nav-btn');
  const skip = button(nav, skipLabel(), handlers.onSkip, 'hud-btn primary hud-skip');
  skip.hidden = true;

  function openJump(): void {
    if (lastMaxJump < 1) return;
    jumpEditing = true;
    trackLabel.hidden = true;
    jumpInput.hidden = false;
    jumpInput.value = String(lastDisplayed ?? 0);
    jumpInput.setAttribute('aria-label', fillTemplate(STRINGS.hudJumpInput, { round: lastMaxJump }));
    jumpInput.focus();
    jumpInput.select();
  }

  function closeJump(restoreFocus = false): void {
    if (!jumpEditing) return;
    jumpEditing = false;
    jumpInput.hidden = true;
    trackLabel.hidden = false;
    if (restoreFocus) trackLabel.focus();
  }

  jumpInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const res = parseJumpRound(jumpInput.value, lastMaxJump);
      if (res.outcome === 'ok') {
        closeJump(false);
        handlers.onNavigate({ to: res.round });
      } else {
        closeJump(true);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeJump(true);
    } else if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1 && !/^[0-9]$/.test(event.key)) {
      event.preventDefault();
    }
  });
  jumpInput.addEventListener('paste', (event) => {
    event.preventDefault();
    const pasted = sanitizeJumpInput(event.clipboardData?.getData('text') ?? '');
    const start = jumpInput.selectionStart ?? jumpInput.value.length;
    const end = jumpInput.selectionEnd ?? jumpInput.value.length;
    jumpInput.setRangeText(pasted, start, end, 'end');
  });
  jumpInput.addEventListener('input', () => {
    const clean = sanitizeJumpInput(jumpInput.value);
    if (jumpInput.value !== clean) jumpInput.value = clean;
  });
  jumpInput.addEventListener('blur', () => closeJump(false));

  // FR-662: mouse wheel over the round buttons shifts the window without scrolling the page.
  trackBox.addEventListener(
    'wheel',
    (event) => {
      if (lastWindowCount <= lastCapacity) return;
      event.preventDefault();
      const raw = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const steps = wheelSteps(raw, event.deltaMode);
      if (steps !== 0) shiftBy(steps);
    },
    { passive: false },
  );

  // FR-662: horizontal touch swipe over the round strip shifts the window on phone without panning the map.
  let touchOrigin: { x: number; y: number } | undefined;
  let touchSwiping = false;
  trackBox.addEventListener(
    'touchstart',
    (event) => {
      if (event.touches.length !== 1 || lastWindowCount <= lastCapacity) {
        touchOrigin = undefined;
        touchSwiping = false;
        return;
      }
      const touch = event.touches[0]!;
      touchOrigin = { x: touch.clientX, y: touch.clientY };
      touchSwiping = false;
    },
    { passive: true },
  );
  trackBox.addEventListener(
    'touchmove',
    (event) => {
      if (touchOrigin === undefined || event.touches.length !== 1) return;
      const touch = event.touches[0]!;
      const dx = touch.clientX - touchOrigin.x;
      const dy = touch.clientY - touchOrigin.y;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) >= 8) {
        touchSwiping = true;
        event.preventDefault();
      }
    },
    { passive: false },
  );
  trackBox.addEventListener('touchend', (event) => {
    if (touchOrigin === undefined) return;
    const touch = event.changedTouches[0];
    const origin = touchOrigin;
    touchOrigin = undefined;
    if (!touchSwiping || touch === undefined) return;
    touchSwiping = false;
    const metrics = TRACK_METRICS[layout];
    const delta = swipeShift(touch.clientX - origin.x, metrics.slotPx + metrics.gapPx);
    if (delta !== 0) shiftBy(delta);
  });

  // State card: the one polite live region of the screen.
  const card = zone('state-card', 'hud-card hud-frame', root);
  card.setAttribute('role', 'status');
  card.setAttribute('aria-live', 'polite');
  const cardTitle = el('div', 'hud-title', card);
  const cardText = el('p', '', card);
  const cardChampion = el('p', 'hud-champion', card);
  card.hidden = true;

  // FR-408 + spec 031: the reveal duel callout (victim -> absorber); a real button so tap, Enter or Space dismisses it.
  const bannerBox = zone('round-banner', 'hud-banner', root);
  bannerBox.hidden = true;
  const bannerButton = button(bannerBox, '', handlers.onBannerDismiss, 'hud-banner-card hud-duel hud-frame');
  bannerButton.setAttribute('aria-label', STRINGS.bannerClose);
  const duelBar = el('span', 'hud-duel-bar', bannerButton);
  const duelBarLeft = el('span', 'hud-duel-bar-v', duelBar);
  const duelBarRight = el('span', 'hud-duel-bar-a', duelBar);
  const bannerTitle = el('span', 'hud-title hud-duel-eyebrow', bannerButton);
  const duelSides = el('span', 'hud-duel-sides', bannerButton);
  const duelLeft = el('span', 'hud-duel-side hud-duel-fallen', duelSides);
  const duelLeftSwatch = el('span', 'hud-swatch', duelLeft);
  const duelLeftName = el('span', 'hud-duel-name', duelLeft);
  const duelArrow = el('span', 'hud-duel-arrow', duelSides);
  duelArrow.textContent = STRINGS.bannerDuelArrow;
  const duelRight = el('span', 'hud-duel-side hud-duel-taker', duelSides);
  const duelRightSwatch = el('span', 'hud-swatch', duelRight);
  const duelRightName = el('span', 'hud-duel-name', duelRight);
  const bannerLine = el('span', 'hud-banner-line', bannerButton);
  // FR-409: the overlay between the close of the predictions and the reveal.
  const overlayBox = zone('round-overlay', 'hud-overlay hud-frame', root);
  overlayBox.setAttribute('role', 'status');
  overlayBox.hidden = true;

  // Spec 034: dynamic sliding window over the round strip (recomputed on resize and dock open).
  function shiftBy(delta: number): void {
    if (lastTrack === undefined || lastWindowCount <= lastCapacity) return;
    lastWindowOffset = shiftWindow(lastWindowOffset ?? 1, lastWindowCount, lastCapacity, delta);
    drawTrack(lastTrack, false);
  }

  function refreshTrackOnResize(): void {
    if (lastTrack !== undefined) drawTrack(lastTrack, true);
  }

  // Phone dock (FR-439, FR-440, FR-441): a handle, the tabs, the pane of the open tab and the strip of the round controls.
  const dock = zone('dock', 'hud-dock hud-frame', root);
  const handle = button(dock, '', () => dockSet(dockHandle(dockNow)), 'hud-handle');
  handle.setAttribute('aria-label', STRINGS.hudDockHandle);
  const tabs = el('div', 'hud-tabs', dock);
  tabs.setAttribute('role', 'tablist');
  const shownTabs = dockTabs(handlers.play !== undefined);
  const panes = new Map<DockTab, HTMLElement>();
  const tabButtons = new Map<DockTab, HTMLElement>();
  let dockNow: DockState = dockStart(shownTabs);
  const paintDock = (): void => {
    root.dataset.dock = dockNow.folded ? 'folded' : 'open';
    handle.setAttribute('aria-expanded', String(!dockNow.folded));
    for (const [tab, node] of tabButtons) node.setAttribute('aria-selected', String(tab === dockNow.tab));
    for (const [tab, node] of panes) node.hidden = dockNow.folded || tab !== dockNow.tab;
    if (!dockNow.folded) refreshTrackOnResize();
    handlers.onDock?.(dockNow.folded);
  };
  const dockSet = (next: DockState): void => {
    dockNow = next;
    paintDock();
  };
  for (const tab of DOCK_TABS.filter((t) => shownTabs.includes(t.id))) {
    const node = button(tabs, tab.label, () => dockSet(dockPress(dockNow, tab.id)), 'hud-tab');
    node.setAttribute('role', 'tab');
    tabButtons.set(tab.id, node);
    const pane = el('div', 'hud-pane', dock);
    pane.setAttribute('role', 'tabpanel');
    panes.set(tab.id, pane);
  }
  const strip = el('div', 'hud-strip', dock);

  /** The desk zones and the dock tabs hold the same builders: the panel (prediction, result) and the round controls, the chronicle, the factions, the ranking. */
  const place = (): void => {
    if (layout === 'phone') {
      (panes.get('order') ?? panes.get('chronicle'))?.append(command);
      command.insertBefore(victim, winner);
      pillBox.hidden = true;
      strip.append(controls);
      panes.get('chronicle')?.append(chronSection);
      panes.get('factions')?.append(factionsSection);
      panes.get('ranking')?.append(rightColumn);
    } else {
      left.append(chronSection, factionsSection);
      pillBox.append(victim);
      pillBox.hidden = victim.hidden || last?.hud.band !== undefined || last?.hud.card !== undefined;
      command.append(controls);
      root.append(left, command, rightColumn);
    }
    boardVisible();
    paintDock();
  };
  place();
  window.addEventListener('resize', () => {
    sizeDock();
    const now = layoutFor(window.innerWidth);
    if (now !== layout) {
      layout = now;
      root.dataset.layout = now;
      place();
    }
    refreshTrackOnResize();
  });

  const write = (node: HTMLElement, text: string | undefined): void => {
    node.textContent = text ?? '';
    node.hidden = text === undefined;
  };

  let chronSig = '';
  const winnersBlock = (parent: HTMLElement, line: WinnersLine): void => {
    const box = el('div', 'hud-winners', parent);
    el('span', '', box).textContent = line.view.line ?? '';
    if (line.view.expandable) {
      const expanded = line.view.names.length > 0;
      button(box, expanded ? STRINGS.hudShowLess : STRINGS.winnersAll, () => handlers.play?.onWinnersToggle(line.key), 'hud-link-btn').setAttribute('aria-expanded', String(expanded));
      if (expanded) {
        const names = el('ul', 'hud-winners-list', box);
        for (const name of line.view.names) el('li', '', names).textContent = name;
        if (line.view.pages > 1) pager(box, line.view.page, line.view.pages, (delta) => handlers.play?.onWinnersPage(line.key, delta));
      }
    }
  };
  const renderChronicle = (entries: readonly ChronicleEntry[], winners?: ReadonlyMap<number, readonly WinnersLine[]>, loading = false): void => {
    const sig = JSON.stringify([entries, winners === undefined ? [] : [...winners], loading]);
    if (sig === chronSig) return;
    chronSig = sig;
    chronEmpty.textContent = loading ? STRINGS.hudChronicleLoading : STRINGS.hudChronicleEmpty;
    chronEmpty.hidden = entries.length > 0;
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
          for (const line of winners?.get(entry.round) ?? []) winnersBlock(text, line);
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
    const alive = rows.filter((r) => r.alive).length;
    const aliveText = fillTemplate(alive === 1 ? STRINGS.hudAliveOfOne : STRINGS.hudAliveOf, { alive, total });
    factionsHead.textContent = [STRINGS.legendTitle, aliveText].join(' - ');
    for (const [key, chip] of sortButtons) chip.setAttribute('aria-pressed', String(key === sortKey));
    const matched = sortRows(searchRows(rows, query), sortKey);
    const { shown, hidden } = visibleRows(matched, LIST_LIMIT, showAll);
    const totalOwned = totalTerritories(rows);
    legend.replaceChildren(
      ...shown.map((row) => {
        const item = el('li', row.alive ? 'hud-row' : 'hud-row out');
        const rgb = colors.get(row.id);
        const share = row.alive ? territoryShare(row.territories, totalOwned) : 0;
        if (share > 0 && rgb !== undefined) {
          const bar = el('span', 'hud-row-bar', item);
          bar.style.width = `${(share * 100).toFixed(1)}%`;
          bar.style.background = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        }
        const swatch = el('span', 'hud-swatch', item);
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

  /** Previous / next buttons with "page / pages" between them. */
  function pager(parent: HTMLElement, page: number, pages: number, go: (delta: number) => void): void {
    const row = el('div', 'hud-pager', parent);
    button(row, STRINGS.controlPrevious, () => go(-1), 'hud-btn hud-secondary').disabled = page <= 0;
    el('span', 'hud-num', row).textContent = fillTemplate(STRINGS.boardPageOf, { page: page + 1, total: pages });
    button(row, STRINGS.controlNext, () => go(1), 'hud-btn hud-secondary').disabled = page >= pages - 1;
  }

  /** One prediction block (the command panel has one, the "Orden" tab of the phone dock another); each keeps its own signature. */
  const predictRenderer = (predictBox: HTMLElement): ((view: PredictView | undefined) => void) => {
  let predictSig = '';
  let predictCount: HTMLElement = document.createElement('span');
  return (view: PredictView | undefined): void => {
    predictBox.hidden = view === undefined;
    if (view === undefined) {
      predictSig = '';
      return;
    }
    // The choices are rebuilt only when they change: a rebuild every second would drop the keyboard focus.
    const sig = JSON.stringify({ ...view, countdown: undefined });
    if (sig !== predictSig) {
      predictSig = sig;
      predictBox.replaceChildren();
      const head = el('div', 'hud-predict-head', predictBox);
      el('span', 'hud-title', head).textContent = view.title;
      // The seal is part of the head row: inline between the title and the countdown on the desk, a row of its own under them on the
      // phone (CSS), so it never crowds either. Its slot is reserved while there is something to choose, so the buttons below do not jump.
      if (view.seal !== undefined || view.choices.length > 0) {
        const sealWords = view.seal;
        const seal = el('span', 'hud-seal', head);
        seal.textContent = sealWords ?? '\u00a0';
        if (sealWords === undefined) {
          seal.dataset.empty = 'true';
          seal.setAttribute('aria-hidden', 'true');
        } else {
          seal.title = sealWords;
        }
      }
      predictCount = el('span', 'hud-num hud-predict-count', head);
      el('p', 'hud-line', predictBox).textContent = view.line;
      if (view.choices.length > 0) {
        const picks = el('div', 'hud-picks', predictBox);
        picks.setAttribute('role', 'group');
        picks.setAttribute('aria-label', STRINGS.predictTitle);
        for (const choice of view.choices) {
          const pick = button(picks, choice.name, () => handlers.play?.onPick(choice.faction), 'hud-btn hud-pick');
          pick.setAttribute('aria-pressed', String(choice.selected));
          const swatch = document.createElement('span');
          swatch.className = 'hud-swatch';
          const rgb = colors.get(choice.faction);
          if (rgb !== undefined) swatch.style.background = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
          pick.prepend(swatch);
        }
      }
      if (view.notice !== undefined) {
        const notice = el('div', 'hud-messages', predictBox);
        notice.setAttribute('role', 'alert');
        notice.textContent = view.notice;
      }
    }
    predictCount.textContent = view.countdown === undefined ? '' : fillTemplate(STRINGS.predictCloses, { time: view.countdown });
  };
  };
  const renderPredict = predictRenderer(predictBox);

  let resultSig = '';
  const renderResult = (outcome: ResultView | undefined): void => {
    resultBox.hidden = outcome === undefined;
    const sig = JSON.stringify(outcome ?? null);
    if (outcome === undefined || sig === resultSig) return;
    resultSig = sig;
    resultBox.replaceChildren();
    el('div', 'hud-title', resultBox).textContent = outcome.title;
    resultBox.dataset.right = outcome.right === undefined ? 'none' : String(outcome.right);
    for (const line of outcome.lines) el('p', 'hud-line', resultBox).textContent = line;
  };

  function boardVisible(): void {
    rightColumn.hidden = layout === 'phone' ? false : !hasBoard;
  }
  // Spec 019: the board is built once; each refresh only hands it the new view, which redraws only what changed (NFR-105, NFR-107).
  let boardPanel: BoardPanel | undefined;
  const renderBoard = (board: BoardView | undefined): void => {
    hasBoard = board !== undefined;
    boardVisible();
    if (board === undefined) return;
    boardPanel ??= createBoardPanel(rightColumn, {
      want: (last) => handlers.play?.onBoardWant(last),
      query: (text) => handlers.play?.onBoardQuery(text),
      mine: () => handlers.play?.onBoardMine(),
      cancel: () => handlers.play?.onBoardCancel(),
      retry: () => handlers.play?.onBoardRetry(),
      jumped: () => handlers.play?.onBoardJumped(),
    });
    boardPanel.render(board);
  };

  // The strip is rebuilt only when the visible window or the displayed round changes (a rebuild every second would drop keyboard focus).
  let trackSig = '';
  const drawTrack = (track: RoundTrack, followDisplayed: boolean): void => {
    const displayed = track.items.find((d) => d.state === 'current')?.round ?? 0;
    const applied = track.items.find((d) => d.live)?.round ?? 0;
    const lastItem = track.items[track.items.length - 1];
    const inPlay = lastItem?.state === 'future';
    const lastRound = lastItem?.round ?? 0;
    const previewLabel = applied < 1 ? '' : fillTemplate(STRINGS.roundNow, { round: displayed });
    if (trackLabel.textContent !== previewLabel) trackLabel.textContent = previewLabel;
    const metrics = TRACK_METRICS[layout];
    const measured = trackBox.clientWidth;
    const capacity = windowCapacity(measured > 0 ? measured : layout === 'desk' ? 310 : 200, metrics, lastRound);
    const win = roundWindow(lastRound, displayed, applied, inPlay, capacity, lastWindowOffset, followDisplayed);

    lastTrack = track;
    lastWindowOffset = win.offset > 0 ? win.offset : undefined;
    lastDisplayed = displayed;
    lastApplied = applied;
    lastCapacity = capacity;
    lastWindowCount = win.count;
    lastMaxJump = win.maxJump;

    const sig = JSON.stringify([win.start, win.items, win.canShiftLeft, win.canShiftRight, win.label, win.canJump, win.maxJump]);
    if (sig === trackSig) return;
    trackSig = sig;

    trackLabel.textContent = win.label;
    trackLabel.disabled = !win.canJump;
    trackLabel.setAttribute('aria-label', win.canJump ? fillTemplate(STRINGS.hudJumpTrigger, { round: win.maxJump }) : win.label);
    trackLabel.title = win.canJump ? fillTemplate(STRINGS.hudJumpTrigger, { round: win.maxJump }) : '';

    startDot.className = `hud-dot ${win.start.state}${win.start.live ? ' live' : ''} start`;
    if (win.start.state === 'current') startDot.setAttribute('aria-current', 'true');
    else startDot.removeAttribute('aria-current');

    pagerPrev.disabled = !win.canShiftLeft;
    pagerNext.disabled = !win.canShiftRight;

    trackBox.replaceChildren();
    for (const dot of win.items) {
      const target = trackTarget(dot);
      const node = button(trackBox, String(dot.round), () => target !== undefined && handlers.onNavigate(target), `hud-dot ${dot.state}${dot.live ? ' live' : ''}`);
      node.setAttribute('aria-label', fillTemplate(target === undefined ? STRINGS.hudTrackInPlay : STRINGS.hudTrackRound, { round: dot.round }));
      node.disabled = target === undefined;
      if (dot.state === 'current') node.setAttribute('aria-current', 'true');
    }
  };

  const renderTrack = (track: RoundTrack): void => {
    const displayed = track.items.find((d) => d.state === 'current')?.round ?? 0;
    const applied = track.items.find((d) => d.live)?.round ?? 0;
    const wasFollowingLive = lastDisplayed === undefined || (lastApplied !== undefined && lastDisplayed === lastApplied);
    const follow = displayed !== lastDisplayed || (applied !== lastApplied && wasFollowingLive);
    drawTrack(track, follow);
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
      pillBox.hidden = layout !== 'desk' || victim.hidden || hud.band !== undefined || hud.card !== undefined;
      const pillRgb = hud.targetColor;
      pillSwatch.hidden = pillRgb === undefined;
      if (pillRgb !== undefined) pillSwatch.style.background = `rgb(${pillRgb[0]},${pillRgb[1]},${pillRgb[2]})`;
      write(winner, view.winner);
      write(halt, view.halt);
      write(mismatch, view.mismatch);
      cardTitle.textContent = hud.card?.title ?? '';
      cardText.textContent = hud.card?.text ?? '';
      const champion = hud.card === undefined ? undefined : hud.play?.champion;
      cardChampion.hidden = champion === undefined;
      cardChampion.textContent = champion?.text ?? '';
      cardChampion.dataset.you = champion?.you === true ? 'yes' : 'no';
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
      bannerBox.hidden = hud.banner === undefined;
      bannerBox.dataset.fade = hud.banner?.fade === true ? 'on' : 'off';
      const duel = hud.banner?.duel;
      bannerTitle.textContent = duel?.eyebrow ?? hud.banner?.title ?? '';
      duelLeftName.textContent = duel?.victimName ?? '';
      duelRightName.textContent = duel?.absorberName ?? '';
      const vRgb = duel === undefined ? undefined : colors.get(duel.victimId);
      const aRgb = duel === undefined ? undefined : colors.get(duel.absorberId);
      if (vRgb !== undefined) {
        const cssRgb = `rgb(${vRgb[0]},${vRgb[1]},${vRgb[2]})`;
        duelLeftSwatch.style.background = cssRgb;
        duelBarLeft.style.background = cssRgb;
      }
      if (aRgb !== undefined) {
        const cssRgb = `rgb(${aRgb[0]},${aRgb[1]},${aRgb[2]})`;
        duelRightSwatch.style.background = cssRgb;
        duelBarRight.style.background = cssRgb;
      }
      bannerLine.textContent = duel?.detail ?? hud.banner?.line ?? '';
      overlayBox.hidden = hud.overlay === undefined;
      overlayBox.textContent = hud.overlay ?? '';
      renderChronicle(hud.chronicle, hud.play?.winners, hud.chronicleLoading === true);
      const chip = hud.play?.chip;
      chipButton.hidden = chip === undefined;
      chipName.textContent = hud.play?.chipParts?.name ?? '';
      chipStats.textContent = hud.play?.chipParts?.stats ?? '';
      chipButton.setAttribute('aria-label', chip === undefined ? '' : `${chip}. ${STRINGS.personalTitle}`);
      command.dataset.offer = hud.play?.predict?.countdown !== undefined ? 'open' : 'closed';
      renderPredict(hud.play?.predict);
      renderResult(hud.play?.result);
      renderBoard(hud.play?.board);
      renderFactions();
      renderTrack(hud.track);
      dockSet(dockStep(dockNow, { tabs: shownTabs, held: hud.hold === true, offer: hud.play?.predict?.countdown !== undefined }));
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
    calloutRect(): ScreenRect | undefined {
      if (bannerBox.hidden) return undefined;
      const box = bannerButton.getBoundingClientRect();
      return box.width > 0 && box.height > 0 ? { x: box.left, y: box.top, w: box.width, h: box.height } : undefined;
    },
    mapAreaRect(): ScreenRect {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const topBottom = top.getBoundingClientRect().bottom || (layout === 'desk' ? 52 : 50);
      if (layout === 'phone') {
        const dockTop = dock.getBoundingClientRect().top || vh;
        return { x: 0, y: topBottom, w: vw, h: Math.max(1, dockTop - topBottom) };
      }
      const leftRight = left.hidden ? 0 : left.getBoundingClientRect().right;
      const rightEdgeCandidates: number[] = [vw];
      if (!rightColumn.hidden) {
        const rr = rightColumn.getBoundingClientRect();
        if (rr.width > 0) rightEdgeCandidates.push(rr.left);
      }
      if (!minimap.hidden) {
        const mr = minimap.getBoundingClientRect();
        if (mr.width > 0) rightEdgeCandidates.push(mr.left);
      }
      const rightLeft = Math.min(...rightEdgeCandidates);
      const cmdTop = command.hidden ? vh : (command.getBoundingClientRect().top || vh);
      const x0 = Math.max(0, leftRight);
      const x1 = Math.max(x0 + 1, rightLeft);
      const y0 = Math.max(0, topBottom);
      const y1 = Math.max(y0 + 1, cmdTop);
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    },
  };
}
