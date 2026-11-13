// The layout of the match screen (spec 010 FR-356, FR-357, NFR-66): which HUD zones exist at which width. Pure: the DOM shell
// (`ui/live-hud.ts`) places what this module names; nothing here touches the page.
import { STRINGS } from './strings';

/** From this width the desktop layout applies; below it the phone layout. */
export const BREAKPOINT = 1024;

export type Layout = 'desk' | 'phone';

export const layoutFor = (width: number): Layout => (width >= BREAKPOINT ? 'desk' : 'phone');

export type Zone = 'top-bar' | 'left-column' | 'right-column' | 'minimap' | 'command-panel' | 'dock';

/** The zones of each layout, in the order the shell creates them. The map itself is the whole viewport behind them. */
export const ZONES: Readonly<Record<Layout, readonly Zone[]>> = {
  desk: ['top-bar', 'left-column', 'right-column', 'minimap', 'command-panel'],
  phone: ['top-bar', 'minimap', 'dock'],
};

export type DockTab = 'order' | 'chronicle' | 'factions' | 'ranking';

export const DOCK_TABS: readonly { readonly id: DockTab; readonly label: string }[] = [
  { id: 'order', label: STRINGS.hudTabOrder },
  { id: 'chronicle', label: STRINGS.hudChronicle },
  { id: 'factions', label: STRINGS.legendTitle },
  { id: 'ranking', label: STRINGS.hudTabRanking },
];

/** Phone sizes in CSS pixels: the top bar, the folded dock (a grab handle and the tabs) and the touch targets. */
export const PHONE = { topBar: 50, dockFolded: 72, touchTarget: 44, tabHeight: 50, strip: 92, chip: 36, paneMin: 120, shareTall: 0.4, shareShort: 0.45, shortBelow: 700 } as const;

/** The pane of the open dock in CSS px: what is left of its share of the screen once the bar and the strip are taken. */
export const dockPaneHeight = (viewportHeight: number): number => {
  const share = viewportHeight >= PHONE.shortBelow ? PHONE.shareTall : PHONE.shareShort;
  return Math.max(PHONE.paneMin, Math.floor(viewportHeight * share) - PHONE.dockFolded - PHONE.strip);
};

/** The height of the phone dock in CSS px (FR-445): the slim bar when folded; open, bar + pane + strip, at most 40 % (45 % on a short screen) of the viewport. The CSS custom properties `--hud-pane-h` and `--hud-dock-h` follow this. */
export const dockHeight = (viewportHeight: number, folded: boolean): number => (folded ? PHONE.dockFolded : PHONE.dockFolded + dockPaneHeight(viewportHeight) + PHONE.strip);

/** The canvas margins the HUD covers (FR-443): none on the desk; on the phone the top bar and the dock as it stands (folded or open). `canvasHeight` is the height of the canvas (100vh: with the mobile address bar showing it is taller than the visible `height`, and its extra part lies below the dock). The camera works on what is left. */
export const mapInset = (width: number, height: number, folded: boolean, canvasHeight: number = height): { top: number; bottom: number } =>
  layoutFor(width) === 'desk' ? { top: 0, bottom: 0 } : { top: PHONE.topBar, bottom: dockHeight(height, folded) + Math.max(0, canvasHeight - height) };

/** The share of the viewport height the map keeps visible on a phone with the dock folded. */
export const mapShareFolded = (viewportHeight: number): number => 1 - (PHONE.topBar + PHONE.dockFolded) / viewportHeight;
