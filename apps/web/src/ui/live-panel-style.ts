// The stylesheet of the match screen HUD (spec 010), as a string so the shell injects it and the tests scan it. Colours are the
// token variables of core/hud-tokens.ts; the layout is chosen by data-layout, never by a media query.
export const PANEL_CSS = `/* The match screen HUD (spec 010). Colours come from the token variables ('--hud-*', set from core/hud-tokens.ts); the layout
   is chosen by 'data-layout' on the root (set from core/hud-layout.ts), never by a media query, so JS and CSS cannot disagree. */
.hud { position: fixed; inset: 0; pointer-events: none; color: var(--hud-text); font: 14px/1.45 var(--hud-body, Spectral, Georgia, serif); }
.hud > * { pointer-events: auto; }
.hud [hidden] { display: none !important; }
.hud-frame { background: var(--hud-wood); box-shadow: inset 0 0 0 1px var(--hud-gilt-dim), inset 0 0 0 4px var(--hud-wood), inset 0 0 0 5px var(--hud-gilt-dim); }
.hud-title { font: 600 17px var(--hud-display, 'Cormorant SC', Georgia, serif); letter-spacing: 0.03em; color: var(--hud-gilt); }
.hud-muted { color: var(--hud-muted); font-style: italic; font-size: 12px; }
.hud-num { font-variant-numeric: lining-nums tabular-nums; }

/* top bar */
.hud-top { position: absolute; left: 0; right: 0; top: 0; height: 58px; display: flex; align-items: center; gap: 24px; padding: 0 20px; }
.hud-top .hud-round { font: 600 26px var(--hud-display, 'Cormorant SC', Georgia, serif); }
.hud-top .hud-count { margin-left: auto; font: 600 34px var(--hud-display, 'Cormorant SC', Georgia, serif); }
.hud-top .hud-count:empty { display: none; }

/* left column: factions */
.hud-left { position: absolute; left: 12px; top: 70px; width: 262px; max-height: calc(100vh - 82px); overflow: auto; padding: 14px 16px; }
.hud-legend { list-style: none; margin: 8px 0 0; padding: 0; }
.hud-legend li { display: flex; align-items: center; gap: 9px; min-height: 27px; font-size: 13px; }
.hud-legend li.out { color: var(--hud-muted); text-decoration: line-through; }
.hud-swatch { width: 12px; height: 12px; border-radius: 2px; flex: none; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4); }

/* command panel */
.hud-command { position: absolute; left: 286px; right: 240px; bottom: 12px; min-height: 120px; padding: 14px 18px; display: flex; flex-direction: column; gap: 10px; }
.hud-line { font-size: 14px; }
.hud-line:empty { display: none; }
.hud-alert { color: var(--hud-ember); }
.hud-nav { display: flex; gap: 8px; flex-wrap: wrap; }
.hud-btn { min-height: 36px; min-width: 36px; padding: 0 14px; border: 0; cursor: pointer; background: var(--hud-wood2); color: var(--hud-text); font: 500 13px var(--hud-body, Spectral, Georgia, serif); box-shadow: inset 0 0 0 1px var(--hud-gilt-dim); }
.hud-btn:disabled { opacity: 0.45; cursor: default; }
.hud-btn.primary { background: var(--hud-gilt); color: var(--hud-on-gilt); box-shadow: none; font-weight: 600; }
.hud :focus-visible { outline: 2px solid var(--hud-gilt); outline-offset: 2px; }

/* state card */
.hud-card { position: absolute; left: 50%; top: 70px; transform: translateX(-50%); width: min(460px, calc(100vw - 24px)); padding: 14px 18px; }
.hud-card .hud-title { font-size: 19px; }
.hud-card p { margin: 4px 0 0; }
.hud[data-state="loading"] .hud-card,
.hud[data-state="error"] .hud-card { top: 50%; transform: translate(-50%, -50%); }
.hud-bar { height: 3px; margin-top: 12px; background: var(--hud-wood2); overflow: hidden; }
.hud-bar i { display: block; width: 40%; height: 100%; background: var(--hud-gilt); animation: hud-slide 1.6s ease-in-out infinite alternate; }
@keyframes hud-slide { from { transform: translateX(0); } to { transform: translateX(150%); } }

/* phone */
.hud-dock { position: absolute; left: 0; right: 0; bottom: 0; display: none; }
.hud[data-layout="phone"] .hud-dock { display: block; }
.hud[data-layout="phone"] .hud-left,
.hud[data-layout="phone"] .hud-right { position: static; width: auto; max-height: none; box-shadow: none; background: none; padding: 0; }
.hud[data-layout="phone"] .hud-command { position: static; min-height: 0; padding: 10px 16px; box-shadow: none; background: none; }
.hud[data-layout="phone"] .hud-top { height: 50px; gap: 10px; padding: 0 10px; }
.hud[data-layout="phone"] .hud-top .hud-round { font-size: 22px; }
.hud[data-layout="phone"] .hud-top .hud-count { font-size: 30px; }
.hud[data-layout="phone"] .hud-top .hud-phase,
.hud[data-layout="phone"] .hud-top .hud-alive { display: none; }
.hud[data-layout="phone"] .hud-btn { min-height: 44px; min-width: 44px; }
.hud[data-layout="phone"] .hud-legend li { min-height: 44px; }
.hud[data-layout="phone"] .hud-card { top: 58px; }
.hud[data-layout="phone"][data-dock="folded"] .hud-left,
.hud[data-layout="phone"][data-dock="folded"] .hud-stage,
.hud[data-layout="phone"][data-dock="folded"] .hud-command > .hud-title { display: none; }
.hud-tabs { display: flex; margin-top: 6px; }
.hud-tab { flex: 1; min-height: 50px; border: 0; border-top: 3px solid transparent; background: none; color: var(--hud-muted); font: 600 16px var(--hud-display, 'Cormorant SC', Georgia, serif); cursor: pointer; }
.hud-tab[aria-selected="true"] { color: var(--hud-gilt); border-top-color: var(--hud-gilt); }
.hud-pane { max-height: 46vh; overflow: auto; padding: 4px 4px 8px; }

/* messages of the address */
.hud-messages { color: var(--hud-ember); font-size: 13px; }
.hud-messages:empty { display: none; }

@media (prefers-reduced-motion: reduce) {
  .hud *, .hud-error * { animation: none !important; transition: none !important; }
  .hud-bar i { width: 100%; }
}
`;
