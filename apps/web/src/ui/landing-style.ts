// Stylesheet of the start menu landing (spec 030 FR-611..FR-616, NFR-141).
// Lives apart from live-panel-style.ts so concurrent HUD panel changes (spec 031) rebase cleanly.
// Uses only --hud-* tokens and black rgba shadows; layout follows data-layout (no width media queries).
export const LANDING_CSS = `
.landing {
  position: fixed;
  inset: 0;
  overflow-x: hidden;
  overflow-y: auto;
  background: var(--hud-umber);
  color: var(--hud-text);
  font: 15px/1.5 var(--hud-body, Spectral, Georgia, serif);
}
.landing * { box-sizing: border-box; }
.landing [hidden] { display: none !important; }
.landing :focus-visible { outline: 2px solid var(--hud-gilt); outline-offset: 2px; }

/* Full-bleed static mid-round atlas on the right, veiled softly into the dark umber backdrop. */
.landing-atlas {
  position: fixed;
  inset: 0;
  pointer-events: none;
  background-repeat: no-repeat;
  background-size: cover;
  background-position: 54% 48%;
  z-index: 0;
}
.landing-veil {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 1;
  background:
    linear-gradient(90deg, var(--hud-umber) 0%, var(--hud-umber) 29%, rgba(0, 0, 0, 0.72) 48%, rgba(0, 0, 0, 0.22) 74%, rgba(0, 0, 0, 0.42) 100%),
    linear-gradient(180deg, rgba(0, 0, 0, 0.55) 0%, rgba(0, 0, 0, 0) 18%, rgba(0, 0, 0, 0) 78%, rgba(0, 0, 0, 0.62) 100%);
}

/* Main shell: anchored left console on desktop, clean stacked column on phone. */
.landing-shell {
  position: relative;
  z-index: 2;
  width: 100%;
  max-width: 100%;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 24px 48px 32px;
}

.landing-console {
  width: 100%;
  max-width: 590px;
  margin: auto 0;
  padding: 24px 0;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.landing-brand {
  display: flex;
  align-items: center;
  gap: 20px;
}
.landing-logo {
  width: 62px;
  height: 70px;
  flex: none;
  display: block;
}
.landing-wordmark {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.landing-title {
  margin: 0;
  font: 700 54px/0.96 var(--hud-display, 'Cormorant SC', Georgia, serif);
  letter-spacing: 0.085em;
  color: var(--hud-text);
}
.landing-subtitle {
  display: inline-block;
  align-self: flex-start;
  padding: 3px 12px 3px 10px;
  border-left: 2px solid var(--hud-gilt);
  background: var(--hud-wood);
  font: 600 11px/1.2 var(--hud-display, 'Cormorant SC', Georgia, serif);
  letter-spacing: 0.24em;
  color: var(--hud-gilt);
}

.landing-pitch {
  margin: 0;
  font: 400 17px/1.45 var(--hud-body, Spectral, Georgia, serif);
  color: var(--hud-text);
}

/* Primary entry box: match link, spectator link or 16-char code. */
.landing-entry {
  position: relative;
  padding: 16px 20px;
  background: var(--hud-panel);
  border: 1px solid var(--hud-gilt-dim);
  backdrop-filter: blur(6px);
}
.landing-entry-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.landing-entry-title {
  font: 600 14px/1.2 var(--hud-display, 'Cormorant SC', Georgia, serif);
  letter-spacing: 0.14em;
  color: var(--hud-gilt);
}
.landing-entry-hint {
  font: italic 12px/1.2 var(--hud-body, Spectral, Georgia, serif);
  color: var(--hud-muted);
  cursor: pointer;
}
.landing-entry .hud-form {
  margin-top: 0;
  gap: 10px;
  flex-wrap: nowrap;
}
.landing-entry .hud-input {
  min-height: 44px;
  padding: 0 14px;
  font-size: 14px;
}
.landing-entry .hud-btn.primary {
  min-height: 44px;
  padding: 0 20px;
  font: 600 13px/1 var(--hud-display, 'Cormorant SC', Georgia, serif);
  letter-spacing: 0.14em;
}
.landing-entry .hud-messages:not(:empty) {
  margin-top: 10px;
}

/* Secondary action row: create match disclosure + drawer. */
.landing-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.landing-toggle {
  min-height: 42px;
  padding: 0 16px;
  font: 600 13px/1 var(--hud-display, 'Cormorant SC', Georgia, serif);
  letter-spacing: 0.12em;
  background: var(--hud-wood);
  color: var(--hud-text);
  border: 0;
  box-shadow: inset 0 0 0 1px var(--hud-gilt-dim);
  cursor: pointer;
}
.landing-toggle[aria-expanded="true"] {
  background: var(--hud-wood2);
  color: var(--hud-gilt);
  box-shadow: inset 0 0 0 1px var(--hud-gilt);
}
.landing-drawer {
  padding: 16px 20px;
  background: var(--hud-panel);
  border: 1px solid var(--hud-gilt-dim);
  backdrop-filter: blur(6px);
}
.landing-drawer .hud-create {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}

/* Footer row: dev-only links on left, static atlas plate caption on right. */
.landing-footer {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.landing-footer .hud-tools {
  margin-top: 0;
}
.landing-badge {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  padding: 8px 16px;
  background: var(--hud-panel);
  border: 1px solid var(--hud-gilt-dim);
  backdrop-filter: blur(6px);
}
.landing-badge-caption {
  font: 500 13px/1.25 var(--hud-body, Spectral, Georgia, serif);
  color: var(--hud-text);
}

/* Desktop fine-tuning (>= 1024px) */
.hud[data-layout="desk"] .landing-entry .hud-input {
  min-width: 0;
}

/* Phone layout (< 1024px): visible map crest on top, crisp vertical console below, 44px+ targets. */
.hud[data-layout="phone"] .landing-atlas {
  position: absolute;
  inset: 0 0 auto 0;
  height: 290px;
  background-position: 62% 44%;
}
.hud[data-layout="phone"] .landing-veil {
  position: absolute;
  inset: 0 0 auto 0;
  height: 290px;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.45) 0%, rgba(0, 0, 0, 0.14) 38%, var(--hud-umber) 100%);
}
.hud[data-layout="phone"] .landing-shell {
  padding: 16px 16px 24px;
  gap: 16px;
}
.hud[data-layout="phone"] .landing-console {
  margin: 118px 0 0;
  padding: 0;
  gap: 16px;
  max-width: none;
}
.hud[data-layout="phone"] .landing-brand {
  gap: 14px;
}
.hud[data-layout="phone"] .landing-logo {
  width: 50px;
  height: 56px;
}
.hud[data-layout="phone"] .landing-title {
  font-size: clamp(24px, 7.6vw, 34px);
  letter-spacing: 0.06em;
}
.hud[data-layout="phone"] .landing-subtitle {
  font-size: 10px;
  letter-spacing: 0.18em;
}
.hud[data-layout="phone"] .landing-pitch {
  font-size: 16px;
}
.hud[data-layout="phone"] .landing-entry {
  padding: 16px;
}
.hud[data-layout="phone"] .landing-entry .hud-form {
  flex-direction: column;
}
.hud[data-layout="phone"] .landing-entry .hud-input,
.hud[data-layout="phone"] .landing-entry .hud-btn.primary,
.hud[data-layout="phone"] .landing-toggle {
  width: 100%;
  min-width: 0;
  min-height: 44px;
}
.hud[data-layout="phone"] .landing-footer {
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
}
.hud[data-layout="phone"] .landing-badge {
  margin-left: 0;
}

@media (prefers-reduced-motion: reduce) {
  .landing *, .landing *::before, .landing *::after {
    animation: none !important;
    transition: none !important;
  }
}
`;
