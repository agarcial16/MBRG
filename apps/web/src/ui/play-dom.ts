// Small DOM helpers of the player screens (spec 013): the card over the hidden map, the share and copy controls. No decisions here:
// the pure modules (`core/play-*`, `core/lobby-model`) decide what to show; the texts are all in the strings module.
import { layoutFor } from '../core/hud-layout';
import { STRINGS } from '../core/strings';
import { showCard } from './live-panel';

export function h(tag: string, className = '', parent?: HTMLElement): HTMLElement {
  const node = document.createElement(tag);
  if (className !== '') node.className = className;
  parent?.append(node);
  return node;
}

export function button(parent: HTMLElement, label: string, onClick: () => void, className = 'hud-btn'): HTMLButtonElement {
  const node = h('button', className, parent) as HTMLButtonElement;
  node.type = 'button';
  node.textContent = label;
  node.addEventListener('click', onClick);
  return node;
}

const mapElements = (): HTMLElement[] => ['map', 'labels'].map((id) => document.getElementById(id)).filter((node): node is HTMLElement => node !== null);

/** The map canvases back on screen (the match scene is about to draw on them). */
export function showMap(): void {
  for (const node of mapElements()) node.style.display = node.id === 'map' ? 'block' : '';
}

/** A card over the hidden map, centred, in the layout of the viewport; the content is appended by the caller. */
export function openCard(title: string, text: string): HTMLElement {
  for (const node of mapElements()) node.style.display = 'none';
  const panel = document.getElementById('panel') as HTMLElement;
  showCard(panel, { title, text }, false);
  const root = panel.firstElementChild as HTMLElement;
  root.dataset.state = 'start';
  root.dataset.layout = layoutFor(window.innerWidth);
  const card = root.firstElementChild as HTMLElement;
  card.removeAttribute('role');
  return card;
}

/** A read-only link field with a copy button (and the phone share sheet where it exists); `status` receives the result line. */
export function linkRow(parent: HTMLElement, label: string, link: string, copyLabel: string): HTMLElement {
  const row = h('div', 'hud-link', parent);
  const input = h('input', 'hud-input', row) as HTMLInputElement;
  input.type = 'text';
  input.readOnly = true;
  input.value = link;
  input.setAttribute('aria-label', label);
  input.addEventListener('focus', () => input.select());
  const status = h('div', 'hud-note', parent);
  status.setAttribute('role', 'status');
  button(row, copyLabel, () => {
    const done = (text: string): void => void (status.textContent = text);
    if (navigator.clipboard === undefined) return done(STRINGS.shareCopyFailed);
    navigator.clipboard.writeText(link).then(
      () => done(STRINGS.shareCopied),
      () => done(STRINGS.shareCopyFailed),
    );
  }, 'hud-btn primary');
  if (typeof navigator.share === 'function') {
    button(row, STRINGS.shareSend, () => {
      void navigator.share({ url: link }).catch(() => undefined);
    });
  }
  return row;
}
