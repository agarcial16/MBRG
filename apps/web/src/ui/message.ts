// One Spanish message instead of the map (an error that ends a scene): the same card as the other states of the match screen.
import { STRINGS } from '../core/strings';
import { showCard } from './live-panel';

export function showMessage(message: string): void {
  const canvas = document.getElementById('map');
  const labels = document.getElementById('labels');
  if (canvas !== null) canvas.style.display = 'none';
  if (labels !== null) labels.style.display = 'none';
  const panel = document.getElementById('panel');
  if (panel === null) return;
  const card = showCard(panel, { title: STRINGS.hudErrorTitle, text: message }, false);
  const actions = document.createElement('div');
  actions.className = 'hud-form';
  const back = document.createElement('a');
  back.className = 'hud-btn primary';
  back.setAttribute('href', '?start');
  back.textContent = STRINGS.hudBackToMenu;
  actions.append(back);
  card.append(actions);
}
