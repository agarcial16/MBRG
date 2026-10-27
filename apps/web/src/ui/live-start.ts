// The start screen of the single entry page (spec 010 FR-366): a code or a link in, the match screen out. The debug scene and the
// web test client are development tools: their links exist in a development build only.
import { STRINGS } from '../core/strings';
import { matchAddress } from '../core/start-screen';
import { showCard } from './live-panel';

export function showStart(): void {
  const canvas = document.getElementById('map');
  const labels = document.getElementById('labels');
  if (canvas !== null) canvas.style.display = 'none';
  if (labels !== null) labels.style.display = 'none';
  const panel = document.getElementById('panel');
  if (panel === null) return;
  showCard(panel, { title: STRINGS.startTitle, text: STRINGS.startText }, false);
  const root = panel.firstElementChild as HTMLElement;
  root.dataset.state = 'start';
  const card = root.firstElementChild as HTMLElement;
  const form = document.createElement('form');
  form.className = 'hud-form';
  // A plain GET form: the browser itself goes to the address, so this file calls no navigation function (the 161 scan).
  form.method = 'get';
  form.action = window.location.pathname;
  const input = document.createElement('input');
  input.type = 'text';
  input.name = 'match';
  input.className = 'hud-input';
  input.placeholder = STRINGS.startCode;
  input.setAttribute('aria-label', STRINGS.startCode);
  input.autocomplete = 'off';
  const enter = document.createElement('button');
  enter.type = 'submit';
  enter.className = 'hud-btn primary';
  enter.textContent = STRINGS.startEnter;
  const problem = document.createElement('div');
  problem.className = 'hud-messages';
  problem.setAttribute('role', 'alert');
  form.append(input, enter);
  card.append(form, problem);
  form.addEventListener('submit', (event) => {
    const address = matchAddress(input.value);
    if (!address.ok) {
      event.preventDefault();
      problem.textContent = STRINGS.startInvalid;
      return;
    }
    // The form sends the match code alone: a pasted link is reduced to it first.
    input.value = address.id;
  });
  if (import.meta.env.DEV) {
    const tools = document.createElement('div');
    tools.className = 'hud-tools';
    for (const [href, label] of [
      ['?seed=1', STRINGS.debugTitle],
      ['/client.html', STRINGS.clientTitle],
    ] as const) {
      const link = document.createElement('a');
      link.setAttribute('href', href);
      link.textContent = label;
      tools.append(link);
    }
    card.append(tools);
  }
}
