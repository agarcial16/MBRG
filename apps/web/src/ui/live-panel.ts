// The live panel DOM (FR-305, NFR-56). Thin: every text comes from `core/live-view` (itself built from the strings module);
// this file only builds elements and writes them. It shows the round, the stage, the countdown, the victim, the winner, the
// halt reason, the connection notice, the controls and the legend. No seed, no pointer readout, no timings, no results.
import type { Rgb } from '@mbrg/shared';
import type { LivePanelView } from '../core/live-view';
import type { NavAction } from '../core/navigation';
import { STRINGS } from '../core/strings';
import { liveTitle, skipLabel } from '../core/live-text';

export interface LivePanelHandlers {
  onNavigate(action: NavAction): void;
  onReset(): void;
  /** FR-339: complete the running tour at once. */
  onSkip(): void;
}

export interface LivePanel {
  update(view: LivePanelView): void;
  /** The skip button shows while a tour runs (FR-339). */
  showSkip(visible: boolean): void;
  /** Replaces the address notices (a round above N, an invalid parameter). */
  showMessages(messages: readonly string[]): void;
}

function block(parent: HTMLElement, tag: string, style = ''): HTMLElement {
  const el = document.createElement(tag);
  if (style !== '') el.style.cssText = style;
  parent.append(el);
  return el;
}

function button(parent: HTMLElement, label: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = label;
  el.setAttribute('aria-label', label);
  el.addEventListener('click', onClick);
  parent.append(el);
  return el;
}

const swatchCss = (rgb: Rgb): string =>
  `display:inline-block;width:12px;height:12px;margin-right:6px;border:1px solid #2b2b2b;background:rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;

export function createLivePanel(container: HTMLElement, colors: ReadonlyMap<number, Rgb>, handlers: LivePanelHandlers): LivePanel {
  container.style.cssText =
    'position:fixed;top:0;right:0;width:320px;max-width:100vw;max-height:100vh;overflow:auto;box-sizing:border-box;padding:10px;' +
    'font:13px/1.4 sans-serif;color:#1c1c1c;background:rgba(245,243,236,0.94);border-left:1px solid #8a8678';
  container.replaceChildren();
  const title = block(container, 'h1', 'margin:0 0 6px;font-size:15px');
  title.textContent = liveTitle();
  const messages = block(container, 'div', 'color:#9b1c1c;margin-bottom:6px');
  messages.setAttribute('role', 'alert');
  const notice = block(container, 'div', 'color:#7a4b00;margin-bottom:6px');
  notice.setAttribute('role', 'status');
  const round = block(container, 'div', 'font-weight:bold');
  const stage = block(container, 'div');
  const countdown = block(container, 'div', 'font-variant-numeric:tabular-nums');
  const victim = block(container, 'div');
  const winner = block(container, 'div');
  const halt = block(container, 'div', 'color:#9b1c1c');
  const skip = button(block(container, 'div', 'margin-top:6px'), skipLabel(), handlers.onSkip);
  skip.style.display = 'none';
  const nav = block(container, 'div', 'display:flex;gap:4px;margin:8px 0 4px');
  const first = button(nav, STRINGS.controlFirst, () => handlers.onNavigate('first'));
  const previous = button(nav, STRINGS.controlPrevious, () => handlers.onNavigate('previous'));
  const next = button(nav, STRINGS.controlNext, () => handlers.onNavigate('next'));
  const last = button(nav, STRINGS.controlLast, () => handlers.onNavigate('last'));
  const reset = block(container, 'div', 'margin-bottom:8px');
  button(reset, STRINGS.controlReset, handlers.onReset);
  const legendTitle = block(container, 'h2', 'margin:0 0 4px;font-size:13px');
  legendTitle.textContent = STRINGS.legendTitle;
  const legend = block(container, 'ul', 'margin:0 0 8px;padding:0;list-style:none');

  const write = (el: HTMLElement, text: string | undefined): void => {
    el.textContent = text ?? '';
    el.style.display = text === undefined ? 'none' : '';
  };

  return {
    update(view: LivePanelView): void {
      write(round, view.round);
      write(stage, view.stage);
      write(countdown, view.countdown);
      write(victim, view.victim);
      write(winner, view.winner);
      write(halt, view.halt);
      write(notice, view.notice);
      const controls = view.controls;
      first.disabled = controls === undefined || controls.firstDisabled;
      previous.disabled = controls === undefined || controls.previousDisabled;
      next.disabled = controls === undefined || controls.nextDisabled;
      last.disabled = controls === undefined || controls.lastDisabled;
      legend.replaceChildren(
        ...view.legend.map((row) => {
          const item = document.createElement('li');
          const swatch = document.createElement('span');
          const rgb = colors.get(row.faction);
          if (rgb !== undefined) swatch.style.cssText = swatchCss(rgb);
          item.append(swatch, row.text);
          if (!row.alive) item.style.opacity = '0.55';
          return item;
        }),
      );
    },
    showSkip(visible: boolean): void {
      skip.style.display = visible ? '' : 'none';
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
  };
}
