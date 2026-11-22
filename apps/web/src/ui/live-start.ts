// The start menu landing of the single entry page (spec 010 FR-366, spec 030 FR-610..FR-616):
// anchored left console (Logo 1 SVG, MBRG brand, pitch, match/spectator link input, match creation)
// over a deterministic rotating static mid-round atlas on the right. Debug tools exist in dev only.
import { LOGO_CROWN, LOGO_REGIONS, LOGO_VIEWBOX } from '../core/brand-logo';
import { layoutFor } from '../core/hud-layout';
import { cssVariables } from '../core/hud-tokens';
import { atlasCaption, nextVisitIndex, selectAtlasPlate } from '../core/landing-atlas';
import { matchAddress } from '../core/start-screen';
import { STRINGS } from '../core/strings';
import { LANDING_CSS } from './landing-style';
import { PANEL_CSS } from './live-panel-style';
import { mountCreate } from './play-create';
import { enterCreated, playNets } from './play-main';
import { requestId } from './web-crypto';

const SVG_NS = 'http://www.w3.org/2000/svg';

function installLandingStyles(): void {
  if (document.getElementById('hud-style') === null) {
    const hud = document.createElement('style');
    hud.id = 'hud-style';
    hud.textContent = cssVariables() + PANEL_CSS;
    document.head.append(hud);
  }
  if (document.getElementById('landing-style') === null) {
    const style = document.createElement('style');
    style.id = 'landing-style';
    style.textContent = LANDING_CSS;
    document.head.append(style);
  }
}

function el(tag: string, className: string, parent?: HTMLElement): HTMLElement {
  const node = document.createElement(tag);
  if (className !== '') node.className = className;
  parent?.append(node);
  return node;
}

function svgEl(tag: string, attrs: Readonly<Record<string, string>>, parent: SVGElement): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent.append(node);
  return node;
}

/** Builds Logo 1 (faceted muted map regions topped by a golden crown) as an inline SVG. */
function buildBrandLogo(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', LOGO_VIEWBOX);
  svg.setAttribute('class', 'landing-logo');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  for (const points of LOGO_CROWN.diamonds) {
    svgEl('polygon', { points, fill: 'var(--hud-gilt)' }, svg);
  }
  svgEl('polygon', { points: LOGO_CROWN.bodyLeft, fill: 'var(--hud-gilt)' }, svg);
  svgEl('polygon', { points: LOGO_CROWN.bodyRight, fill: 'var(--hud-gilt-dim)' }, svg);
  svgEl('rect', {
    x: String(LOGO_CROWN.band.x),
    y: String(LOGO_CROWN.band.y),
    width: String(LOGO_CROWN.band.width),
    height: String(LOGO_CROWN.band.height),
    rx: String(LOGO_CROWN.band.rx),
    fill: 'var(--hud-gilt)',
  }, svg);

  for (const region of LOGO_REGIONS) {
    svgEl('polygon', {
      points: region.points,
      fill: region.fill,
      stroke: 'var(--hud-umber)',
      'stroke-width': '1.6',
      'stroke-linejoin': 'round',
    }, svg);
  }
  return svg;
}

export function showStart(): void {
  const canvas = document.getElementById('map');
  const labels = document.getElementById('labels');
  if (canvas !== null) canvas.style.display = 'none';
  if (labels !== null) labels.style.display = 'none';
  const panel = document.getElementById('panel');
  if (panel === null) return;

  installLandingStyles();
  document.title = STRINGS.landingBrand;

  const visit = nextVisitIndex(window.localStorage);
  const plate = selectAtlasPlate(visit);

  panel.replaceChildren();
  const root = el('div', 'hud', panel);
  root.dataset.state = 'start';
  root.dataset.layout = layoutFor(window.innerWidth);
  window.addEventListener('resize', () => {
    root.dataset.layout = layoutFor(window.innerWidth);
  });

  const stage = el('main', 'landing', root);
  const atlas = el('div', 'landing-atlas', stage);
  atlas.setAttribute('aria-hidden', 'true');
  atlas.dataset.plate = plate.id;
  atlas.style.backgroundImage = `url("${plate.assetUrl}")`;
  el('div', 'landing-veil', stage).setAttribute('aria-hidden', 'true');

  const shell = el('div', 'landing-shell', stage);

  // Top kicker line.
  const kicker = el('div', 'landing-kicker', shell);
  el('span', 'landing-dot', kicker).setAttribute('aria-hidden', 'true');
  el('span', '', kicker).textContent = STRINGS.landingKicker;

  // Anchored left console: brand lockup, pitch, match/spectator entry, create disclosure.
  const consoleBox = el('section', 'landing-console', shell);

  const brand = el('div', 'landing-brand', consoleBox);
  brand.append(buildBrandLogo());
  const wordmark = el('div', 'landing-wordmark', brand);
  el('h1', 'landing-title', wordmark).textContent = STRINGS.landingBrand;
  el('div', 'landing-subtitle', wordmark).textContent = STRINGS.landingSubtitle;

  el('p', 'landing-pitch', consoleBox).textContent = STRINGS.landingPitch;

  // Entry box: accepts a bare match code, a match URL, or a spectator URL (spectate=1).
  const entry = el('div', 'landing-entry', consoleBox);
  const entryHead = el('div', 'landing-entry-head', entry);
  el('div', 'landing-entry-title', entryHead).textContent = STRINGS.startTitle;
  el('div', 'landing-entry-hint', entryHead).textContent = STRINGS.landingInputHint;

  const form = document.createElement('form');
  form.className = 'hud-form';
  // A plain GET form: the browser itself goes to the address, so this file calls no navigation function (the 161 scan).
  form.method = 'get';
  form.action = window.location.pathname;

  const input = document.createElement('input');
  input.type = 'text';
  input.name = 'match';
  input.className = 'hud-input';
  input.placeholder = STRINGS.landingInputPlaceholder;
  input.setAttribute('aria-label', STRINGS.startCode);
  input.autocomplete = 'off';

  const spectateInput = document.createElement('input');
  spectateInput.type = 'hidden';
  spectateInput.name = 'spectate';
  spectateInput.value = '1';
  spectateInput.disabled = true;

  const enter = document.createElement('button');
  enter.type = 'submit';
  enter.className = 'hud-btn primary';
  enter.textContent = STRINGS.startEnter;

  const problem = document.createElement('div');
  problem.className = 'hud-messages';
  problem.setAttribute('role', 'alert');

  form.append(input, spectateInput, enter);
  entry.append(form);
  el('p', 'landing-helper', entry).textContent = STRINGS.startText;
  entry.append(problem);

  form.addEventListener('submit', (event) => {
    const address = matchAddress(input.value);
    if (!address.ok) {
      event.preventDefault();
      spectateInput.disabled = true;
      problem.textContent = STRINGS.startInvalid;
      return;
    }
    // The form sends the match code (and spectate=1 for spectator links): a pasted link is reduced to them first.
    input.value = address.id;
    spectateInput.disabled = address.spectate !== true;
  });

  // Spec 013 FR-393: create a match from the public config inside an expandable drawer; host token stays in this browser.
  const actions = el('div', 'landing-actions', consoleBox);
  const createToggle = document.createElement('button');
  createToggle.type = 'button';
  createToggle.className = 'landing-toggle';
  createToggle.textContent = STRINGS.landingCreateToggle;
  createToggle.setAttribute('aria-expanded', 'false');
  actions.append(createToggle);

  const drawer = el('div', 'landing-drawer', consoleBox);
  drawer.hidden = true;
  let createMounted = false;
  createToggle.addEventListener('click', () => {
    const open = drawer.hidden;
    drawer.hidden = !open;
    createToggle.setAttribute('aria-expanded', String(open));
    createToggle.textContent = open ? STRINGS.landingCreateClose : STRINGS.landingCreateToggle;
    if (open && !createMounted) {
      createMounted = true;
      mountCreate(drawer, { net: playNets().net, storage: window.localStorage, makeId: requestId, onCreated: enterCreated });
    }
  });

  // Footer: development tools (dev builds only) and the static atlas caption badge.
  const footer = el('footer', 'landing-footer', shell);
  if (import.meta.env.DEV) {
    const tools = el('div', 'hud-tools', footer);
    for (const [href, label] of [
      ['?seed=1', STRINGS.debugTitle],
      ['/client.html', STRINGS.clientTitle],
    ] as const) {
      const link = document.createElement('a');
      link.setAttribute('href', href);
      link.textContent = label;
      tools.append(link);
    }
  }

  const badge = el('div', 'landing-badge', footer);
  el('span', 'landing-dot', badge).setAttribute('aria-hidden', 'true');
  const badgeText = el('div', 'landing-badge-text', badge);
  el('span', 'landing-badge-tag', badgeText).textContent = STRINGS.landingAtlasTag;
  el('span', 'landing-badge-caption', badgeText).textContent = atlasCaption(plate);
}
