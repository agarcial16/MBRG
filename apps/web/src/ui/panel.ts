// The debug panel DOM (FR-154, FR-156, FR-157, FR-158). Thin: every text comes from core/panel-text and
// the UI strings; this file only builds elements and writes them.
import type { PresentationData, Rgb } from '@mbrg/shared';
import { controlsState } from '../core/navigation';
import type { NavAction } from '../core/navigation';
import { legendLine, livingLine, perfLines, pointerLines, recordLine, roundStatus, seedLine } from '../core/panel-text';
import type { Timings } from '../core/panel-text';
import type { PointerInfo, Scene } from '../core/scene';
import { STRINGS } from '../core/strings';

export interface PanelHandlers {
  onNavigate(action: NavAction): void;
  onTypedRound(text: string): void;
  onReset(): void;
}

export interface Panel {
  showScene(scene: Scene): void;
  showPointer(info: PointerInfo | undefined): void;
  showTimings(timings: Timings): void;
  /** Replaces the messages (address problems, a rejected typed round, errors). */
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

export function createPanel(
  container: HTMLElement,
  presentation: PresentationData,
  colors: ReadonlyMap<number, Rgb>,
  handlers: PanelHandlers,
): Panel {
  container.style.cssText =
    'position:fixed;top:0;right:0;width:320px;max-width:100vw;max-height:100vh;overflow:auto;box-sizing:border-box;padding:10px;' +
    'font:13px/1.4 sans-serif;color:#1c1c1c;background:rgba(245,243,236,0.94);border-left:1px solid #8a8678';
  container.replaceChildren();
  const title = block(container, 'h1', 'margin:0 0 6px;font-size:15px');
  title.textContent = STRINGS.debugTitle;

  const messages = block(container, 'div', 'color:#9b1c1c;margin-bottom:6px');
  messages.setAttribute('role', 'alert');
  const header = block(container, 'div');
  const living = block(container, 'div', 'margin-bottom:6px');

  const nav = block(container, 'div', 'display:flex;gap:4px;margin-bottom:4px');
  const first = button(nav, STRINGS.controlFirst, () => handlers.onNavigate('first'));
  const previous = button(nav, STRINGS.controlPrevious, () => handlers.onNavigate('previous'));
  const next = button(nav, STRINGS.controlNext, () => handlers.onNavigate('next'));
  const last = button(nav, STRINGS.controlLast, () => handlers.onNavigate('last'));

  const form = block(container, 'form', 'display:flex;gap:4px;margin-bottom:4px');
  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'numeric';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', STRINGS.roundInputLabel);
  input.style.width = '5em';
  form.append(input);
  const go = document.createElement('button');
  go.type = 'submit';
  go.textContent = STRINGS.controlGo;
  go.setAttribute('aria-label', STRINGS.controlGo);
  form.append(go);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    handlers.onTypedRound(input.value);
  });
  const reset = block(container, 'div', 'margin-bottom:8px');
  button(reset, STRINGS.controlReset, handlers.onReset);

  const record = block(container, 'div', 'margin-bottom:8px');
  const legendTitle = block(container, 'h2', 'margin:0 0 4px;font-size:13px');
  legendTitle.textContent = STRINGS.legendTitle;
  const legend = block(container, 'ul', 'margin:0 0 8px;padding:0;list-style:none');
  const pointer = block(container, 'div', 'margin-bottom:8px');
  const perf = block(container, 'div', 'font-variant-numeric:tabular-nums');

  const writeLines = (el: HTMLElement, lines: readonly string[]): void => {
    el.replaceChildren(
      ...lines.map((line) => {
        const row = document.createElement('div');
        row.textContent = line;
        return row;
      }),
    );
  };

  return {
    showScene(scene: Scene): void {
      writeLines(header, [seedLine(scene), roundStatus(scene)]);
      writeLines(living, [livingLine(scene)]);
      writeLines(record, [recordLine(scene, presentation)]);
      legend.replaceChildren(
        ...scene.legend.map((row) => {
          const item = document.createElement('li');
          const swatch = document.createElement('span');
          const rgb = colors.get(row.faction);
          if (rgb !== undefined) swatch.style.cssText = swatchCss(rgb);
          item.append(swatch, legendLine(row));
          if (!row.alive) item.style.opacity = '0.55';
          return item;
        }),
      );
      const state = controlsState(scene.round, scene.total);
      first.disabled = state.firstDisabled;
      previous.disabled = state.previousDisabled;
      next.disabled = state.nextDisabled;
      last.disabled = state.lastDisabled;
      input.value = String(scene.round);
    },
    showPointer(info: PointerInfo | undefined): void {
      writeLines(pointer, pointerLines(info));
    },
    showTimings(timings: Timings): void {
      writeLines(perf, perfLines(timings));
    },
    showMessages(list: readonly string[]): void {
      writeLines(messages, list);
    },
  };
}
