import { PHONE } from '../core/hud-layout';
import { TABLE, pageCss } from '../core/table';
// The stylesheet of the match screen HUD (spec 010), as a string so the shell injects it and the tests scan it. Colours are the
// token variables of core/hud-tokens.ts; the layout is chosen by data-layout, never by a media query.
export const PANEL_CSS = `${pageCss()}
/* Self-hosted fonts (SIL Open Font License; the licences are in public/fonts). Latin subset: it covers Spanish. */
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
/* every scrollable area of the HUD uses the HUD tokens (no bright default bar) */
.hud * { scrollbar-width: thin; scrollbar-color: var(--hud-gilt-dim) var(--hud-umber); }
.hud-frame { background: var(--hud-wood); box-shadow: inset 0 0 0 1px var(--hud-gilt-dim); outline: 1px solid var(--hud-gilt-dim); outline-offset: -5px; }
/* spec 015 FR-425: on the desk the panels are a darker, slightly translucent wood with a blur of the map behind; the double gilt frame is two lines, so the panel colour shows between them */
.hud[data-layout="desk"] .hud-frame { background: var(--hud-panel); backdrop-filter: blur(${TABLE.panel.blur}px); }
.hud-title { font: 600 17px var(--hud-display, 'Cormorant SC', Georgia, serif); letter-spacing: 0.03em; color: var(--hud-gilt); }
.hud-muted { color: var(--hud-muted); font-style: italic; font-size: 12px; }
.hud-num { font-variant-numeric: lining-nums tabular-nums; }

/* top bar */
.hud-top { position: absolute; left: 0; right: 0; top: 0; height: 58px; display: flex; align-items: center; box-sizing: border-box; gap: 24px; padding: 0 20px; }
.hud-top .hud-round { font: 600 26px var(--hud-display, 'Cormorant SC', Georgia, serif); }
.hud-top .hud-count { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); font: 600 34px/1 var(--hud-display, 'Cormorant SC', Georgia, serif); }
.hud-top .hud-count { margin: 0; }
.hud-top .hud-count:empty { display: none; }

/* live mark and replay band */
.hud-livemark { color: var(--hud-verdigris); font-style: italic; font-size: 13px; }
.hud-band { position: absolute; left: 50%; top: 66px; transform: translateX(-50%); display: flex; align-items: center; gap: 16px; padding: 8px 14px; max-width: calc(100vw - 24px); }
.hud-band .hud-btn { min-height: 30px; }

/* left column: factions */
.hud-left { position: absolute; left: 12px; top: 70px; width: 280px; box-sizing: border-box; max-height: calc(100vh - 82px); overflow: auto; padding: 14px 16px; }

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
.hud-command { position: absolute; left: 304px; right: 262px; bottom: 12px; min-height: 120px; padding: 14px 18px; display: flex; flex-direction: column; gap: 10px; }
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
.hud-tools a { display: inline-flex; align-items: center; min-height: 32px; color: var(--hud-muted); }
.hud[data-layout="phone"] .hud-tools a { min-height: 44px; min-width: 44px; }

/* minimap */
.hud-mini { position: absolute; right: 12px; bottom: 12px; width: 238px; box-sizing: border-box; padding: 8px 12px 12px; }
.hud-mini .hud-title { font-size: 14px; margin-bottom: 4px; }
.hud-minibox { position: relative; overflow: hidden; touch-action: none; cursor: crosshair; line-height: 0; }
.hud-minicanvas { width: 100%; height: auto; display: block; box-shadow: 0 0 0 1px var(--hud-gilt-dim); }
.hud-minirect { position: absolute; border: 1.5px solid var(--hud-text); box-shadow: 0 0 0 999px rgba(0, 0, 0, 0.28); pointer-events: none; }

/* track of rounds */
.hud-roundsel { display: flex; align-items: center; gap: 8px; min-width: 0; }
.hud-track-label:empty { display: none; }
.hud-track-label { flex: none; color: var(--hud-gilt); font: 600 14px var(--hud-display, 'Cormorant SC', Georgia, serif); white-space: nowrap; }
/* FR-442: ONE row that scrolls sideways, however many rounds there are; the shell keeps the current round in view */
.hud-track { position: relative; display: flex; align-items: center; gap: 6px; flex: 1 1 auto; min-width: 0; flex-wrap: nowrap; overflow-x: auto; overflow-y: hidden; padding: 2px 0; }
.hud-dot { flex: none; min-width: 28px; min-height: 28px; border-radius: 50%; border: 0; background: var(--hud-umber); color: var(--hud-muted); font: 600 12px var(--hud-display, 'Cormorant SC', Georgia, serif); cursor: pointer; box-shadow: inset 0 0 0 1px var(--hud-gilt-dim); }
.hud-dot.current { background: var(--hud-gilt); color: var(--hud-on-gilt); box-shadow: none; }
.hud-dot.live:not(.current) { box-shadow: inset 0 0 0 2px var(--hud-verdigris); color: var(--hud-verdigris); }
.hud-dot:disabled { opacity: 0.45; cursor: default; }
.hud-dot.future { opacity: 1; background: none; color: var(--hud-gilt); box-shadow: inset 0 0 0 1px var(--hud-gilt); }
.hud-slider { width: 100%; accent-color: var(--hud-gilt); }

/* state card */
.hud-card { position: absolute; left: 50%; top: 70px; transform: translateX(-50%); width: min(460px, calc(100vw - 24px)); max-height: calc(100vh - 24px); box-sizing: border-box; overflow-y: auto; padding: 14px 18px; }
.hud-card .hud-title { font-size: 19px; }
.hud-card p { margin: 4px 0 0; }
/* FR-448: the winning player, in verdigris against the gilt of the faction */
.hud-card .hud-champion { color: var(--hud-verdigris); font-weight: 600; }
.hud-card .hud-champion[hidden] { display: none; }
.hud[data-state="loading"] .hud-card,
.hud[data-state="start"] .hud-card,
.hud[data-state="error"] .hud-card { top: 50%; transform: translate(-50%, -50%); }
.hud-bar { height: 3px; margin-top: 12px; background: var(--hud-wood2); overflow: hidden; }
.hud-bar i { display: block; width: 40%; height: 100%; background: var(--hud-gilt); animation: hud-slide 1.6s ease-in-out infinite alternate; }
@keyframes hud-slide { from { transform: translateX(0); } to { transform: translateX(150%); } }

/* phone */
.hud-dock { position: absolute; left: 0; right: 0; bottom: 0; display: none; }
.hud[data-layout="phone"] .hud-dock { display: flex; flex-direction: column; }
/* FR-439: a handle on top of the tabs; the whole dock folds to handle + tabs (72 px) and unfolds again */
.hud-handle { position: relative; display: block; width: 100%; height: 22px; padding: 0; border: 0; background: none; cursor: pointer; flex: none; }
.hud-handle::before { content: ''; position: absolute; left: 50%; top: 9px; width: 44px; height: 4px; margin-left: -22px; border-radius: 2px; background: var(--hud-gilt-dim); }
.hud-handle::after { content: ''; position: absolute; left: 0; right: 0; top: -22px; bottom: 0; }
.hud[data-layout="phone"] .hud-left,
.hud[data-layout="phone"] .hud-right { position: static; width: auto; max-height: none; box-shadow: none; outline-width: 0; background: none; backdrop-filter: none; padding: 0; }
.hud[data-layout="phone"] .hud-left { display: none; }
.hud[data-layout="phone"] .hud-command { position: static; min-height: 0; padding: 10px 16px; box-shadow: none; outline-width: 0; background: none; backdrop-filter: none; }
.hud[data-layout="phone"] .hud-dock,
.hud[data-layout="phone"] .hud-top,
.hud[data-layout="phone"] .hud-mini { background: var(--hud-dock); backdrop-filter: none; }
.hud[data-layout="phone"] .hud-top { height: 50px; display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); grid-template-areas: "round count chip" "phase count chip"; align-items: center; column-gap: 10px; row-gap: 0; padding: 0 10px; }
.hud[data-layout="phone"] .hud-top .hud-count { position: static; transform: none; grid-area: count; font-size: 26px; white-space: nowrap; justify-self: center; align-self: center; }
.hud[data-layout="phone"] .hud-top .hud-round { grid-area: round; font-size: 20px; line-height: 1.1; white-space: nowrap; min-width: 0; overflow: hidden; text-overflow: ellipsis; align-self: end; }
.hud[data-layout="phone"] .hud-top .hud-phase { grid-area: phase; font-size: 11px; line-height: 1.1; font-style: italic; color: var(--hud-muted); white-space: nowrap; min-width: 0; overflow: hidden; text-overflow: ellipsis; align-self: start; }
.hud[data-layout="phone"] .hud-top .hud-playerchip { grid-area: chip; justify-self: end; align-self: center; min-width: 0; max-width: 100%; font-size: 12px; }
.hud[data-layout="phone"] .hud-btn { min-height: 44px; min-width: 44px; }
.hud[data-layout="phone"] .hud-chip,
.hud[data-layout="phone"] .hud-dot,
.hud[data-layout="phone"] .hud-search { min-height: 44px; min-width: 44px; }
.hud[data-layout="phone"] .hud-mini { top: 58px; right: 8px; bottom: auto; width: 104px; padding: 4px 6px 6px; }
.hud[data-layout="phone"] .hud-mini .hud-title { display: none; }
/* a tall map never makes the minimap taller than the room the cards below it were placed for */
.hud[data-layout="phone"] .hud-minicanvas { width: auto; height: auto; max-width: 100%; max-height: 92px; margin: 0 auto; }
.hud[data-layout="phone"] .hud-band { top: 58px; }
.hud[data-layout="phone"] .hud-livemark { display: none; }
.hud[data-layout="phone"] .hud-legend li { min-height: 44px; }
/* a state card (winner, halt) sits under the minimap, never over it (58 px bar + about 100 px minimap) */
.hud[data-layout="phone"] .hud-card { top: 168px; max-height: calc(100vh - 168px - var(--hud-dock-h) - 8px); }
/* FR-446: the winner of a finished match is one slim line under the bar, left of the minimap, so it never covers the map the player is reviewing */
.hud[data-layout="phone"][data-state="finished"] .hud-card { top: 58px; left: 8px; transform: none; width: auto; max-width: calc(100vw - 128px); max-height: none; padding: 6px 10px; }
.hud[data-layout="phone"][data-state="finished"] .hud-card .hud-title { font-size: 15px; }
.hud[data-layout="phone"][data-state="finished"] .hud-card p:not(.hud-champion) { display: none; }
.hud[data-layout="phone"][data-state="loading"] .hud-card,
.hud[data-layout="phone"][data-state="start"] .hud-card,
.hud[data-layout="phone"][data-state="error"] .hud-card { top: 50%; max-height: calc(100vh - 24px); }
.hud-tabs { display: flex; flex: none; }
.hud-tab { flex: 1; min-height: 50px; border: 0; border-top: 3px solid transparent; background: none; color: var(--hud-muted); font: 600 16px var(--hud-display, 'Cormorant SC', Georgia, serif); cursor: pointer; }
.hud-tab[aria-selected="true"] { color: var(--hud-gilt); border-top-color: var(--hud-gilt); }
.hud[data-layout="phone"] .hud-tab { min-width: 0; padding: 0 2px; font-size: 15px; }
.hud[data-layout="phone"][data-dock="folded"] .hud-tab[aria-selected="true"] { color: var(--hud-muted); border-top-color: transparent; }
.hud-pane { max-height: 46vh; overflow: auto; padding: 10px 16px 18px; }

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
.hud-btn { white-space: nowrap; }
.hud-link .hud-input { min-width: 0; flex: 1 1 160px; }
.hud-link .hud-btn { flex: none; }
.hud[data-layout="desk"] .hud-link { flex-wrap: nowrap; }
.hud-card .hud-messages:not(:empty) { margin-top: 8px; }
.hud-watch { margin-top: 12px; }
.hud-lobby { display: grid; gap: 4px 24px; }
.hud-lobby > .hud-title { grid-column: 1 / -1; }
.hud[data-layout="desk"] .hud-card.hud-lobby { width: min(760px, calc(100vw - 24px)); grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr); }
.hud[data-layout="phone"] .hud-input { min-height: 44px; }
a.hud-btn { display: inline-flex; align-items: center; text-decoration: none; }
.hud-card select.hud-input { min-width: 0; }

/* prediction and results (spec 013) */
.hud-playerchip { position: relative; display: inline-flex; gap: 0.35em; align-items: center; margin-left: auto; align-self: center; min-width: 0; max-width: min(46vw, calc(50% - 90px)); padding: 2px 12px; border: 0; cursor: pointer; background: none; color: var(--hud-gilt); box-shadow: inset 0 0 0 1px var(--hud-gilt); font: 600 13px/1.25 var(--hud-body, Spectral, Georgia, serif); }
/* the box is as tall as its text; the touch area is the box plus an invisible margin (44 px on the phone, FR-429) */
.hud-playerchip::after { content: ''; position: absolute; left: -6px; right: -6px; top: -8px; bottom: -8px; }
.hud[data-layout="phone"] .hud-playerchip::after { top: -13px; bottom: -13px; }
.hud-chip-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hud-chip-stats { flex: none; white-space: nowrap; }
.hud-pop { position: absolute; right: 12px; top: 58px; width: min(340px, calc(100vw - 24px)); padding: 12px 16px; }
.hud-predict { padding-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.hud-predict-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.hud-predict-count { color: var(--hud-gilt); font-size: 18px; }
.hud-picks { display: flex; flex-wrap: wrap; gap: 6px; max-height: 18vh; overflow: auto; }
.hud-pick { display: inline-flex; align-items: center; gap: 7px; }
.hud-pick[aria-pressed="true"] { background: var(--hud-gilt); color: var(--hud-on-gilt); box-shadow: none; font-weight: 600; }
.hud-seal { align-self: flex-start; padding: 2px 12px; background: none; color: var(--hud-gilt); box-shadow: inset 0 0 0 1px var(--hud-gilt); font: 600 13px var(--hud-body, Spectral, Georgia, serif); }
/* the rule above the result only separates it from a prediction block shown above it; at the top of the panel the frame already draws the two lines (spec 015 FR-430) */
.hud-result { padding-top: 0; }
.hud-predict:not([hidden]) ~ .hud-result { border-top: 1px solid var(--hud-gilt-dim); padding-top: 8px; }
.hud-result p { margin: 2px 0; }
.hud-predict .hud-line { margin: 0; }
.hud-result[data-right="true"] .hud-title { color: var(--hud-verdigris); }
.hud-result[data-right="false"] .hud-title { color: var(--hud-ember); }
/* desk: the command panel is compact (prediction and result side by side, track and buttons on one row) and never crosses the left column or the minimap */
.hud[data-layout="desk"] .hud-command { flex-direction: row; flex-wrap: wrap; align-content: flex-start; gap: 6px 16px; min-height: 0; padding: 8px 14px; max-height: calc(100vh - 82px); overflow: auto; }
.hud[data-layout="desk"] .hud-command > * { flex: 1 1 100%; }
.hud[data-layout="desk"] .hud-command > .hud-predict,
.hud[data-layout="desk"] .hud-command > .hud-result { flex: 1 1 280px; min-width: 0; }
/* the dots and the five controls: ONE row, pinned to the bottom of the panel (the panel is anchored at the bottom, so the buttons never move between states) */
.hud-controls { display: flex; align-items: center; flex-wrap: nowrap; gap: 8px 16px; margin-top: auto; }
.hud-controls > .hud-roundsel { flex: 1 1 0; }
.hud-controls > .hud-nav { flex: none; justify-content: flex-end; flex-wrap: nowrap; gap: 6px; }
.hud[data-layout="desk"] .hud-command > .hud-predict,
.hud[data-layout="desk"] .hud-command > .hud-result { flex: 1 1 100%; }
/* the result is one line (it never grows the panel); the seal sits on the line row of the prediction instead of a row of its own */
.hud-result { display: flex; align-items: baseline; gap: 4px 8px; white-space: nowrap; overflow: hidden; font-size: 13px; }
.hud-result > * { margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; flex: 0 1 auto; }
.hud-result > .hud-title { flex: none; }
.hud-predict { position: relative; }
/* prediction header (second phone test): the seal is a part of the head row: between the title and the countdown on the desk (it shrinks with an ellipsis), on a row of its own on the phone */
.hud-predict-head { flex-wrap: nowrap; min-width: 0; }
.hud-predict-head > .hud-title { flex: none; }
.hud-predict-head > .hud-predict-count { flex: none; margin-left: auto; white-space: nowrap; }
.hud-predict-head > .hud-seal { box-sizing: border-box; flex: 0 1 auto; min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; align-self: center; padding: 1px 10px; font-size: 12px; }
.hud[data-layout="phone"] .hud-predict-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; row-gap: 4px; }
.hud[data-layout="phone"] .hud-predict-head > .hud-title { grid-area: 1 / 1; }
.hud[data-layout="phone"] .hud-predict-head > .hud-predict-count { grid-area: 1 / 2; }
.hud[data-layout="phone"] .hud-predict-head > .hud-seal { grid-area: 2 / 1 / 3 / 3; justify-self: start; }
/* FR-445: no reserved row for a seal that is not there yet (the pane is short); it appears when the player has chosen */
.hud[data-layout="phone"] .hud-predict-head > .hud-seal[data-empty="true"] { display: none; }
/* the total is already in the chip of the top bar and the title is implied by the first line: the result stays one line */
/* no phase open: the result takes the place of the empty prediction block and may use two lines (the forced note is long) */
.hud[data-layout="desk"] .hud-command[data-offer="closed"]:has(.hud-result:not([hidden])) > .hud-predict { display: none; }
.hud[data-layout="desk"] .hud-command[data-offer="closed"] .hud-result { flex-wrap: wrap; white-space: normal; }
.hud[data-layout="desk"] .hud-command[data-offer="closed"] .hud-result > * { overflow: visible; text-overflow: clip; }
.hud[data-layout="desk"] .hud-result > .hud-title,
.hud[data-layout="desk"] .hud-result > p:nth-of-type(3) { display: none; }
.hud[data-layout="desk"] .hud-command:has(.hud-predict:not([hidden])) > .hud-title { display: none; }
.hud[data-layout="desk"] .hud-picks { max-height: 72px; }
/* compact controls on the desk so the panel stays about 230 px tall even at 1024 px wide; the phase sentence is already in the top bar */
.hud[data-layout="desk"] .hud-command .hud-btn { min-height: 30px; padding: 0 10px; }
.hud[data-layout="desk"] .hud-command .hud-nav-btn { min-width: 32px; padding: 0 8px; }
.hud[data-layout="desk"] .hud-command .hud-dot { min-width: 26px; min-height: 26px; }
.hud[data-layout="desk"] .hud-command:has(.hud-predict:not([hidden])) > .hud-stage { display: none; }
.hud-seal[data-empty="true"] { visibility: hidden; }
.hud-right { position: absolute; right: 12px; top: 70px; width: 238px; box-sizing: border-box; max-height: calc(100vh - 340px); overflow: auto; padding: 12px 14px; }
.hud-board { list-style: none; margin: 6px 0 0; padding: 0; }
.hud-boardrow { display: grid; grid-template-columns: 26px 1fr auto; gap: 8px; padding: 3px 0; font-size: 13px; border-bottom: 1px solid var(--hud-wood2); }
.hud-boardrow.me { color: var(--hud-gilt); font-weight: 600; position: sticky; top: 0; bottom: 0; background: var(--hud-wood); }
.hud-boardname { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hud-pager { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; }
.hud-winners { margin-top: 3px; font-size: 12px; color: var(--hud-muted); }
.hud-winners-list { margin: 2px 0 0; padding-left: 16px; }
.hud-link-btn { min-height: 24px; padding: 0 4px; border: 0; background: none; color: var(--hud-gilt); font: 500 12px var(--hud-body, Spectral, Georgia, serif); text-decoration: underline; cursor: pointer; }
.hud[data-layout="phone"] .hud-right { position: static; max-height: none; width: auto; }
.hud[data-layout="phone"] .hud-pop { top: 52px; right: 8px; }
/* phone dock (FR-445): handle + tabs (72 px), one pane that scrolls and the strip of the round controls (FR-439 to FR-441). Open it is at most 40 % of the screen (45 % on a short one); the shell sets --hud-pane-h and --hud-open-h from dockPaneHeight/dockHeight (core/hud-layout.ts) on every resize, these are the same figures as a fallback. --hud-dock-h is the height the dock has now (the camera inset reads it) */
.hud[data-layout="phone"] { --hud-pane-h: max(${PHONE.paneMin}px, calc(100vh * ${PHONE.shareTall} - ${PHONE.dockFolded + PHONE.strip}px)); --hud-strip-h: ${PHONE.strip}px; --hud-open-h: calc(${PHONE.dockFolded}px + var(--hud-pane-h) + var(--hud-strip-h)); --hud-dock-h: ${PHONE.dockFolded}px; }
.hud[data-layout="phone"][data-dock="open"] { --hud-dock-h: var(--hud-open-h); }
.hud[data-layout="phone"] .hud-pane { box-sizing: border-box; height: var(--hud-pane-h); max-height: none; padding: 6px 12px; overflow: hidden auto; overscroll-behavior: contain; }
.hud[data-layout="phone"] .hud-command { padding: 0; gap: 6px; min-height: 0; }
/* the strip: the selector of rounds on one row and the buttons on another, on every tab, never in the scrolling pane */
.hud-strip { display: none; }
.hud[data-layout="phone"] .hud-strip { display: block; flex: none; box-sizing: border-box; height: var(--hud-strip-h); padding: 4px 8px; border-top: 1px solid var(--hud-gilt-dim); }
.hud[data-layout="phone"] .hud-controls { flex-direction: column; align-items: stretch; flex-wrap: nowrap; gap: 4px; margin: 0; }
.hud[data-layout="phone"] .hud-track { scrollbar-width: none; gap: 4px; }
.hud[data-layout="phone"] .hud-track::-webkit-scrollbar { display: none; }
.hud[data-layout="phone"] .hud-track .hud-dot { min-width: ${PHONE.chip}px; min-height: ${PHONE.chip}px; height: ${PHONE.chip}px; padding: 0; }
.hud-dot.start { border-radius: 14px; padding: 0 10px; }
.hud[data-layout="phone"] .hud-track .hud-dot.start { padding: 0 12px; }
.hud[data-layout="phone"] .hud-roundsel { min-height: ${PHONE.chip}px; }
.hud[data-layout="phone"] .hud-nav { display: flex; flex: none; flex-wrap: nowrap; gap: 4px; justify-content: stretch; }
.hud[data-layout="phone"] .hud-nav .hud-btn { flex: 1 1 0; min-width: 44px; padding: 0 4px; }
/* folded: the strip shrinks to the skip button alone, which floats above the tabs while a tour plays */
.hud[data-layout="phone"][data-dock="folded"] .hud-strip { position: absolute; right: 8px; bottom: 100%; height: auto; margin-bottom: 8px; padding: 0; border: 0; }
.hud[data-layout="phone"][data-dock="folded"] .hud-roundsel,
.hud[data-layout="phone"][data-dock="folded"] .hud-nav > .hud-nav-btn { display: none; }
.hud[data-layout="phone"] .hud-command > .hud-title { display: none; }
.hud[data-layout="phone"] .hud-chron-title { display: none; }
.hud[data-layout="phone"] .hud-chron { max-height: none; overflow: visible; margin: 0; }
.hud[data-layout="phone"] .hud-factions-title { margin-top: 0; border-top: 0; padding-top: 0; }
.hud[data-layout="phone"] .hud-result { flex-direction: column; align-items: flex-start; white-space: normal; }
.hud[data-layout="phone"] .hud-predict,
.hud[data-layout="phone"] .hud-result { border-top: 0; padding-top: 0; gap: 4px; }
.hud[data-layout="phone"] .hud-picks { max-height: none; overflow: visible; }
.hud[data-layout="phone"] .hud-command[data-offer="open"] > .hud-result { display: none; }
.hud[data-layout="phone"] .hud-command:has(.hud-predict:not([hidden]), .hud-result:not([hidden])) > .hud-stage { display: none; }
.hud[data-layout="phone"] .hud-command[data-offer="closed"]:has(.hud-result:not([hidden])) > .hud-victim { display: none; }
.hud[data-layout="phone"] .hud-command[data-offer="closed"]:has(.hud-result:not([hidden])) > .hud-predict { display: none; }
/* the ranking scrolls with its pane; the own row stays pinned at the bottom of it */
.hud[data-layout="phone"] .hud-board-mine { position: sticky; bottom: 0; background: var(--hud-dock); }
.hud-board-mine { margin-top: 0; border-top: 1px solid var(--hud-gilt-dim); }

/* messages of the address */
.hud-messages { color: var(--hud-ember); font-size: 13px; }
.hud-messages:empty { display: none; }

/* round banner (FR-408) and the overlay between close and reveal (FR-409) */
.hud-banner { position: absolute; inset: 0; z-index: 5; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.45); }
.hud-banner[hidden] { display: none; }
/* desk: the card rides high so it never sits over the command panel, whose title and timer stay readable */
.hud[data-layout="desk"] .hud-banner { align-items: flex-start; padding-top: max(150px, 22vh); box-sizing: border-box; }
/* phone: the banner centres in the map area, above the dock, so a short screen never hides it behind the dock */
.hud[data-layout="phone"] .hud-banner { box-sizing: border-box; padding-bottom: calc(var(--hud-dock-h) + 8px); }
.hud-banner[data-fade="on"] { animation: hud-fade-in 0.3s ease-out; }
.hud-banner-card { display: flex; flex-direction: column; gap: 6px; align-items: center; text-align: center; min-width: 0; max-width: min(520px, calc(100vw - 24px)); padding: 18px 26px; min-height: 44px; font: inherit; color: var(--hud-text); cursor: pointer; }
.hud-banner-card .hud-title { font-size: 26px; }
.hud-banner-line { font-size: 17px; }
.hud-overlay { position: absolute; left: 50%; top: 110px; transform: translateX(-50%); z-index: 4; padding: 10px 22px; font: 600 20px var(--hud-display, 'Cormorant SC', Georgia, serif); letter-spacing: 0.08em; color: var(--hud-gilt); pointer-events: none; text-align: center; }
.hud-overlay[hidden] { display: none; }
.hud[data-layout="phone"] .hud-overlay { top: 100px; left: 8px; transform: none; box-sizing: border-box; max-width: calc(100vw - 130px); font-size: 16px; }
@keyframes hud-fade-in { from { opacity: 0; } to { opacity: 1; } }

@media (prefers-reduced-motion: reduce) {
  .hud *, .hud-error * { animation: none !important; transition: none !important; }
  .hud-bar i { width: 100%; }
}
`;
