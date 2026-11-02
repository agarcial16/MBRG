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
.hud-top { position: absolute; left: 0; right: 0; top: 0; height: 58px; display: flex; align-items: baseline; padding-top: 12px; box-sizing: border-box; gap: 24px; padding-left: 20px; padding-right: 20px; }
.hud-top .hud-round { font: 600 26px var(--hud-display, 'Cormorant SC', Georgia, serif); }
.hud-top .hud-count { position: absolute; left: 50%; top: 8px; transform: translateX(-50%); font: 600 34px var(--hud-display, 'Cormorant SC', Georgia, serif); }
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
.hud-command { position: absolute; left: 286px; right: 262px; bottom: 12px; min-height: 120px; padding: 14px 18px; display: flex; flex-direction: column; gap: 10px; }
.hud-line { font-size: 14px; }
.hud-line:empty { display: none; }
.hud-alert { color: var(--hud-ember); }
.hud-nav { display: flex; gap: 8px; flex-wrap: wrap; }
.hud-btn { min-height: 36px; min-width: 36px; padding: 0 14px; border: 0; cursor: pointer; background: var(--hud-wood2); color: var(--hud-text); font: 500 13px var(--hud-body, Spectral, Georgia, serif); box-shadow: inset 0 0 0 1px var(--hud-gilt-dim); }
.hud-btn:disabled { opacity: 0.45; cursor: default; }
.hud-btn.primary { background: var(--hud-gilt); color: var(--hud-on-gilt); box-shadow: none; font-weight: 600; }
.hud :focus-visible { outline: 2px solid var(--hud-gilt); outline-offset: 2px; }

/* start screen */
.hud-form { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.hud-input { flex: 1; min-width: 200px; min-height: 40px; padding: 0 10px; background: var(--hud-umber); color: var(--hud-text); border: 0; box-shadow: inset 0 0 0 1px var(--hud-gilt-dim); font: 14px var(--hud-body, Spectral, Georgia, serif); }
.hud-tools { margin-top: 14px; display: flex; gap: 14px; font-size: 12px; }
.hud-tools a { color: var(--hud-muted); }

/* minimap */
.hud-mini { position: absolute; right: 12px; bottom: 12px; width: 238px; box-sizing: border-box; padding: 8px 12px 12px; }
.hud-mini .hud-title { font-size: 14px; margin-bottom: 4px; }
.hud-minibox { position: relative; overflow: hidden; touch-action: none; cursor: crosshair; line-height: 0; }
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
.hud[data-state="start"] .hud-card,
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
.hud[data-layout="phone"] .hud-top { height: 50px; gap: 10px; padding: 8px 10px 0; }
.hud[data-layout="phone"] .hud-top .hud-count { position: static; transform: none; margin-left: auto; }
.hud[data-layout="phone"] .hud-top .hud-round { font-size: 22px; }
.hud[data-layout="phone"] .hud-top .hud-count { font-size: 30px; }
.hud[data-layout="phone"] .hud-top .hud-phase { display: none; }
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

/* create, join and lobby (spec 013) */
.hud-create { margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--hud-gilt-dim); }
.hud-field { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; }
.hud-field > span { color: var(--hud-muted); font-size: 12px; }
.hud-choices { display: flex; gap: 8px; flex-wrap: wrap; }
.hud-choice[aria-pressed="true"] { background: var(--hud-gilt); color: var(--hud-on-gilt); box-shadow: none; font-weight: 600; }
.hud-note { color: var(--hud-muted); font-size: 12px; margin-top: 4px; }
.hud-link { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.hud-personal, .hud-share { margin-top: 12px; }
.hud-count { font-size: 15px; margin-top: 8px; }
.hud-players { list-style: none; margin: 8px 0 0; padding: 0; max-height: 30vh; overflow: auto; }
.hud-players li { padding: 4px 0; border-bottom: 1px solid var(--hud-wood2); }
a.hud-btn { display: inline-flex; align-items: center; text-decoration: none; }
.hud-card select.hud-input { min-width: 0; }

/* prediction and results (spec 013) */
.hud-playerchip { margin-left: auto; align-self: center; min-height: 32px; max-width: 46vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 12px; border: 0; cursor: pointer; background: var(--hud-wax); color: var(--hud-on-wax); font: 600 13px var(--hud-body, Spectral, Georgia, serif); }
.hud-pop { position: absolute; right: 12px; top: 58px; width: min(340px, calc(100vw - 24px)); padding: 12px 16px; }
.hud-predict { border-top: 1px solid var(--hud-gilt-dim); padding-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.hud-predict-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.hud-predict-count { color: var(--hud-gilt); font-size: 18px; }
.hud-picks { display: flex; flex-wrap: wrap; gap: 6px; max-height: 18vh; overflow: auto; }
.hud-pick { display: inline-flex; align-items: center; gap: 7px; }
.hud-pick[aria-pressed="true"] { background: var(--hud-gilt); color: var(--hud-on-gilt); box-shadow: none; font-weight: 600; }
.hud-seal { align-self: flex-start; padding: 2px 12px; background: var(--hud-wax); color: var(--hud-on-wax); font: 600 13px var(--hud-body, Spectral, Georgia, serif); }
.hud-result { border-top: 1px solid var(--hud-gilt-dim); padding-top: 8px; }
.hud-result p { margin: 2px 0; }
.hud-result[data-right="true"] .hud-title { color: var(--hud-verdigris); }
.hud-result[data-right="false"] .hud-title { color: var(--hud-ember); }
.hud-right { position: absolute; right: 12px; top: 70px; width: 238px; box-sizing: border-box; max-height: calc(100vh - 340px); overflow: auto; padding: 12px 14px; }
.hud-board { list-style: none; margin: 6px 0 0; padding: 0; }
.hud-boardrow { display: grid; grid-template-columns: 26px 1fr auto; gap: 8px; padding: 3px 0; font-size: 13px; border-bottom: 1px solid var(--hud-wood2); }
.hud-boardrow.me { color: var(--hud-gilt); font-weight: 600; }
.hud-boardname { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hud-pager { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; }
.hud-winners { margin-top: 3px; font-size: 12px; color: var(--hud-muted); }
.hud-winners-list { margin: 2px 0 0; padding-left: 16px; }
.hud-link-btn { min-height: 24px; padding: 0 4px; border: 0; background: none; color: var(--hud-gilt); font: 500 12px var(--hud-body, Spectral, Georgia, serif); text-decoration: underline; cursor: pointer; }
.hud[data-layout="phone"] .hud-right { position: static; max-height: none; width: auto; }
.hud[data-layout="phone"] .hud-pop { top: 52px; right: 8px; }
.hud[data-layout="phone"] .hud-playerchip { min-height: 44px; }

/* messages of the address */
.hud-messages { color: var(--hud-ember); font-size: 13px; }
.hud-messages:empty { display: none; }

/* round banner (FR-408) and the overlay between close and reveal (FR-409) */
.hud-banner { position: absolute; inset: 0; z-index: 5; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.45); }
.hud-banner[hidden] { display: none; }
.hud-banner[data-fade="on"] { animation: hud-fade-in 0.3s ease-out; }
.hud-banner-card { display: flex; flex-direction: column; gap: 6px; align-items: center; text-align: center; min-width: 0; max-width: min(520px, calc(100vw - 24px)); padding: 18px 26px; min-height: 44px; font: inherit; color: var(--hud-text); cursor: pointer; }
.hud-banner-card .hud-title { font-size: 26px; }
.hud-banner-line { font-size: 17px; }
.hud-overlay { position: absolute; left: 50%; top: 110px; transform: translateX(-50%); z-index: 4; padding: 10px 22px; font: 600 20px var(--hud-display, 'Cormorant SC', Georgia, serif); letter-spacing: 0.08em; color: var(--hud-gilt); pointer-events: none; text-align: center; }
.hud-overlay[hidden] { display: none; }
.hud[data-layout="phone"] .hud-overlay { top: 100px; font-size: 16px; }
@keyframes hud-fade-in { from { opacity: 0; } to { opacity: 1; } }

@media (prefers-reduced-motion: reduce) {
  .hud *, .hud-error * { animation: none !important; transition: none !important; }
  .hud-bar i { width: 100%; }
}
`;
