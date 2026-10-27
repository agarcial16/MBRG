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

export type DockTab = 'match' | 'order' | 'ranking';

export const DOCK_TABS: readonly { readonly id: DockTab; readonly label: string }[] = [
  { id: 'match', label: STRINGS.hudTabMatch },
  { id: 'order', label: STRINGS.hudTabOrder },
  { id: 'ranking', label: STRINGS.hudTabRanking },
];

/** Phone sizes in CSS pixels: the top bar, the folded dock (grab handle, a summary row and the tabs) and the touch targets. */
export const PHONE = { topBar: 50, dockFolded: 160, touchTarget: 44, tabHeight: 50 } as const;

/** The share of the viewport height the map keeps visible on a phone with the dock folded. */
export const mapShareFolded = (viewportHeight: number): number => 1 - (PHONE.topBar + PHONE.dockFolded) / viewportHeight;
