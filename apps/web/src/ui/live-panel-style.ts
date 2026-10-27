// The stylesheet of the match screen HUD (spec 010), as a string so the shell injects it and the tests scan it. Colours are the
// token variables of core/hud-tokens.ts; the layout is chosen by data-layout, never by a media query.
export const PANEL_CSS = `/* Self-hosted fonts (SIL Open Font License; the licences are in public/fonts). Latin subset: it covers Spanish. */
@font-face { font-family: 'Cormorant SC'; font-weight: 500; font-style: normal; font-display: swap; src: url('/fonts/cormorant-sc-500.woff2') format('woff2'); }
@font-face { font-family: 'Cormorant SC'; font-weight: 600; font-style: normal; font-display: swap; src: url('/fonts/cormorant-sc-600.woff2') format('woff2'); }
@font-face { font-family: 'Cormorant SC'; font-weight: 700; font-style: normal; font-display: swap; src: url('/fonts/cormorant-sc-700.woff2') format('woff2'); }
@font-face { font-family: 'Spectral'; font-weight: 400; font-style: normal; font-display: swap; src: url('/fonts/spectral-400.woff2') format('woff2'); }
@font-face { font-family: 'Spectral'; font-weight: 400; font-style: italic; font-display: swap; src: url('/fonts/spectral-italic-400.woff2') format('woff2'); }
@font-face { font-family: 'Spectral'; font-weight: 500; font-style: normal; font-display: swap; src: url('/fonts/spectral-500.woff2') format('woff2'); }
@font-face { font-family: 'Spectral'; font-weight: 600; font-style: normal; font-display: swap; src: url('/fonts/spectral-600.woff2') format('woff2'); }
/* The match screen HUD (spec 010). Colours come from the token variables ('--hud-*', set from core/hud-tokens.ts); the layout
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

/* live mark and replay band */
.hud-livemark { color: var(--hud-verdigris); font-style: italic; font-size: 13px; }
.hud-band { position: absolute; left: 50%; top: 66px; transform: translateX(-50%); display: flex; align-items: center; gap: 16px; padding: 8px 14px; max-width: calc(100vw - 24px); }
.hud-band .hud-btn { min-height: 30px; }

/* left column: factions */
.hud-left { position: absolute; left: 12px; top: 70px; width: 262px; max-height: calc(100vh - 82px); overflow: auto; padding: 14px 16px; }

.hud-chron { list-style: none; margin: 8px 0 12px; padding: 0; display: flex; flex-direction: column; gap: 8px; max-height: 30vh; overflow: auto; }
.hud-chron li { display: grid; grid-template-columns: 26px 1fr; gap: 8px; font-size: 13px; line-height: 1.3; }
.hud-chron b { font: 700 15px var(--hud-display, 'Cormorant SC', Georgia, serif); color: var(--hud-gilt); }
.hud-chron li.pending { color: var(--hud-gilt); }
.hud-factions-title { margin-top: 4px; border-top: 1px solid var(--hud-gilt-dim); padding-top: 10px; font-size: 15px; }
.hud-sort { display: flex; gap: 6px; margin: 8px 0 4px; flex-wrap: wrap; }
.hud-chip { min-height: 28px; padding: 0 8px; border: 0; background: none; color: var(--hud-muted); font: 500 12px var(--hud-body, Spectral, Georgia, serif); cursor: pointer; border-bottom: 1px solid transparent; }
.hud-chip[aria-pressed="true"] { color: var(--hud-gilt); border-bottom-color: var(--hud-gilt); }
.hud-search { width: 100%; min-height: 30px; margin: 4px 0; padding: 0 9px; background: var(--hud-umber); color: var(--hud-text); border: 0; box-shadow: inset 0 0 0 1px var(--hud-gilt-dim); font: italic 12px var(--hud-body, Spectral, Georgia, serif); }
.hud-row { display: grid; grid-template-columns: 12px 1fr 34px 34px 34px; align-items: center; gap: 7px; min-height: 27px; font-size: 13px; }
.hud-headrow { min-height: 18px; font-size: 10.5px; font-style: italic; color: var(--hud-muted); border-bottom: 1px solid var(--hud-gilt-dim); }
.hud-headrow span { text-align: right; }
.hud-name { min-width: 0; }
.hud-name small { display: block; font-size: 11px; color: var(--hud-muted); font-style: italic; line-height: 1.1; margin-bottom: 2px; }
.hud-row.out .hud-name, .hud-row.out .hud-fig { color: var(--hud-muted); }
.hud-row.out .hud-n { text-decoration: line-through; }
.hud-fig { text-align: right; color: var(--hud-muted); }
.hud-legend { list-style: none; margin: 4px 0 0; padding: 0; }
.hud-legend li { min-height: 27px; }
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

/* minimap */
.hud-mini { position: absolute; right: 12px; bottom: 12px; width: 214px; padding: 8px 12px 12px; }
.hud-mini .hud-title { font-size: 14px; margin-bottom: 4px; }
.hud-minibox { position: relative; touch-action: none; cursor: crosshair; line-height: 0; }
.hud-minicanvas { width: 100%; height: auto; display: block; box-shadow: 0 0 0 1px var(--hud-gilt-dim); }
.hud-minirect { position: absolute; border: 1.5px solid var(--hud-text); box-shadow: 0 0 0 999px rgba(0, 0, 0, 0.28); pointer-events: none; }

/* track of rounds */
.hud-track { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.hud-dot { min-width: 28px; min-height: 28px; border-radius: 50%; border: 0; background: var(--hud-umber); color: var(--hud-muted); font: 600 12px var(--hud-display, 'Cormorant SC', Georgia, serif); cursor: pointer; box-shadow: inset 0 0 0 1px var(--hud-gilt-dim); }
.hud-dot.current { background: var(--hud-gilt); color: var(--hud-on-gilt); box-shadow: none; }
.hud-dot.live:not(.current) { box-shadow: inset 0 0 0 2px var(--hud-verdigris); color: var(--hud-verdigris); }
.hud-dot:disabled { opacity: 0.45; cursor: default; }
.hud-slider { width: 100%; accent-color: var(--hud-gilt); }

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
.hud[data-layout="phone"] .hud-chip,
.hud[data-layout="phone"] .hud-dot,
.hud[data-layout="phone"] .hud-search { min-height: 44px; min-width: 44px; }
.hud[data-layout="phone"] .hud-mini { top: 58px; right: 8px; bottom: auto; width: 104px; padding: 4px 6px 6px; }
.hud[data-layout="phone"] .hud-mini .hud-title { display: none; }
.hud[data-layout="phone"] .hud-band { top: 58px; }
.hud[data-layout="phone"] .hud-livemark { display: none; }
.hud[data-layout="phone"] .hud-legend li { min-height: 44px; }
.hud[data-layout="phone"] .hud-card { top: 58px; }
.hud[data-layout="phone"][data-dock="folded"] .hud-left,
.hud[data-layout="phone"][data-dock="folded"] .hud-stage,
.hud[data-layout="phone"][data-dock="folded"] .hud-track,
.hud[data-layout="phone"][data-dock="folded"] .hud-secondary,
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
