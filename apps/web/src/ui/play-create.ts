// The create section of the start screen (spec 013 FR-393 to FR-395): the public maps and the pace read from the public config, a
// create button, one plain sentence per refusal and the values kept after a failure. The host token goes to the browser storage
// and nowhere else; the operator credential is never read here.
import type { PublicConfig } from '@mbrg/protocol';
import { PACES, createBody, createFailure, createOptions, durationText, paceTiming, type Pace } from '../core/play-forms';
import { saveHost, type StorageLike } from '../core/play-token';
import { STRINGS, fillTemplate } from '../core/strings';
import type { PlayNet } from './live-net';
import { button, h } from './play-dom';

export interface CreateDeps {
  readonly net: PlayNet;
  readonly storage: StorageLike;
  /** A new request id for a creation attempt (reused while the choice does not change, so a retry is the same request). */
  readonly makeId: () => string;
  readonly onCreated: (matchId: string) => void;
}

export function mountCreate(parent: HTMLElement, deps: CreateDeps): void {
  const section = h('div', 'hud-create', parent);
  h('div', 'hud-title', section).textContent = STRINGS.createTitle;
  const body = h('div', '', section);
  const problem = h('div', 'hud-messages', section);
  problem.setAttribute('role', 'alert');

  const load = (): void => {
    body.replaceChildren();
    problem.textContent = '';
    h('p', '', body).textContent = STRINGS.createLoading;
    void deps.net.config().then((read) => {
      body.replaceChildren();
      if (!read.ok) {
        h('p', 'hud-messages', body).textContent = STRINGS.createConfigFailed;
        button(body, STRINGS.createRetry, load);
        return;
      }
      form(body, problem, read.value, deps);
    });
  };
  load();
}

function form(body: HTMLElement, problem: HTMLElement, config: PublicConfig, deps: CreateDeps): void {
  const options = createOptions(config);
  if (!options.enabled) {
    h('p', '', body).textContent = STRINGS.createOff;
    return;
  }
  h('p', '', body).textContent = STRINGS.createText;

  const mapLabel = h('label', 'hud-field', body);
  h('span', '', mapLabel).textContent = STRINGS.createMap;
  const select = h('select', 'hud-input', mapLabel) as HTMLSelectElement;
  for (const id of options.maps) {
    const option = h('option', '', select) as HTMLOptionElement;
    option.value = id;
    option.textContent = id;
  }

  const paceBox = h('div', 'hud-field', body);
  h('span', '', paceBox).textContent = STRINGS.createPace;
  const choices = h('div', 'hud-choices', paceBox);
  choices.setAttribute('role', 'group');
  choices.setAttribute('aria-label', STRINGS.createPace);
  const line = h('div', 'hud-note', paceBox);
  let pace: Pace = 'normal';
  const marks = new Map<Pace, HTMLButtonElement>();
  const refresh = (): void => {
    for (const [id, node] of marks) node.setAttribute('aria-pressed', String(id === pace));
    line.textContent = fillTemplate(STRINGS.createPaceLine, { time: durationText(paceTiming(pace, config).i) });
  };
  for (const entry of PACES) {
    marks.set(entry.id, button(choices, entry.label, () => {
      pace = entry.id;
      refresh();
    }, 'hud-btn hud-choice'));
  }
  refresh();

  let attempt: { readonly key: string; readonly requestId: string } | undefined;
  const create = button(body, STRINGS.createButton, () => {
    problem.textContent = '';
    // The same choice is the same request (a retry after a network failure is answered from the server's memo).
    const key = `${select.value}|${pace}`;
    attempt = attempt !== undefined && attempt.key === key ? attempt : { key, requestId: deps.makeId() };
    create.disabled = true;
    create.textContent = STRINGS.createWorking;
    void deps.net.create(createBody({ mapId: select.value, pace, config, requestId: attempt.requestId })).then((read) => {
      create.disabled = false;
      create.textContent = STRINGS.createButton;
      if (!read.ok) {
        // The form keeps its values: nothing is rebuilt.
        problem.textContent = createFailure(read.outcome, read.retryAfter);
        return;
      }
      saveHost(deps.storage, read.value.matchId, read.value.hostToken);
      deps.onCreated(read.value.matchId);
    });
  }, 'hud-btn primary');
}
