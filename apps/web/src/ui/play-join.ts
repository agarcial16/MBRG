// The join screen (spec 013 FR-396, FR-397, FR-400): a name field that applies the name rule before sending, the sentences of the
// refusals, and the personal link. The player token the server issues once goes to the browser storage and nowhere else.
import type { PublicMatch } from '@mbrg/protocol';
import { afterJoin } from '../core/lobby-model';
import { checkName, joinFailure } from '../core/play-forms';
import { matchLink, personalLink, savePlayer } from '../core/play-token';
import type { PlayerCredentials, StorageLike } from '../core/play-token';
import { STRINGS } from '../core/strings';
import type { PlayNet } from './live-net';
import { button, h, linkRow, openCard } from './play-dom';

export interface JoinDeps {
  readonly matchId: string;
  readonly net: PlayNet;
  readonly storage: StorageLike;
  /** The page address without query or fragment, for the links. */
  readonly pageUrl: string;
  readonly makeId: () => string;
  /** The viewer holds the host token of this match (it created it). */
  readonly host: boolean;
  readonly onLobby: (player: PlayerCredentials) => void;
  readonly onMatch: (player: PlayerCredentials | undefined) => void;
}

/** The personal link block: the warning and a copy control (FR-397). */
export function personalBlock(parent: HTMLElement, pageUrl: string, matchId: string, player: PlayerCredentials): void {
  const box = h('div', 'hud-personal', parent);
  h('div', 'hud-title', box).textContent = STRINGS.personalTitle;
  h('p', 'hud-note', box).textContent = STRINGS.personalWarn;
  linkRow(box, STRINGS.personalTitle, personalLink(pageUrl, matchId, player), STRINGS.personalCopy);
}

/** The join screen of a lobby or a running match. */
export function showJoin(deps: JoinDeps): void {
  const card = openCard(STRINGS.joinTitle, STRINGS.joinText);
  if (deps.host) {
    h('p', 'hud-note', card).textContent = STRINGS.joinHostNote;
    h('div', 'hud-title', card).textContent = STRINGS.shareTitle;
    linkRow(card, STRINGS.shareLabel, matchLink(deps.pageUrl, deps.matchId), STRINGS.shareCopy);
  }
  const form = h('form', 'hud-form', card) as HTMLFormElement;
  const input = h('input', 'hud-input', form) as HTMLInputElement;
  input.type = 'text';
  input.name = 'name';
  input.autocomplete = 'off';
  input.maxLength = 48;
  input.setAttribute('aria-label', STRINGS.joinName);
  input.placeholder = STRINGS.joinName;
  const submit = h('button', 'hud-btn primary', form) as HTMLButtonElement;
  submit.type = 'submit';
  submit.textContent = STRINGS.joinButton;
  const problem = h('div', 'hud-messages', card);
  problem.setAttribute('role', 'alert');
  button(card, STRINGS.joinWatch, () => deps.onMatch(undefined), 'hud-btn hud-watch');

  // The same name is the same request while it is retried (the server answers a repeat from its memo, FR-296).
  let draft: { readonly name: string; readonly requestId: string } | undefined;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    problem.textContent = '';
    const checked = checkName(input.value);
    if (!checked.ok) {
      problem.textContent = checked.sentence;
      return;
    }
    draft = draft !== undefined && draft.name === checked.name ? draft : { name: checked.name, requestId: deps.makeId() };
    submit.disabled = true;
    submit.textContent = STRINGS.joinWorking;
    void deps.net.join(deps.matchId, { name: checked.name, requestId: draft.requestId }).then((read) => {
      submit.disabled = false;
      submit.textContent = STRINGS.joinButton;
      if (!read.ok) {
        problem.textContent = joinFailure(read.outcome, read.retryAfter);
        return;
      }
      const player: PlayerCredentials = { playerId: read.value.playerId, token: read.value.playerToken };
      savePlayer(deps.storage, deps.matchId, player);
      arrive(deps, read.value.match, player);
    });
  });
}

/** After a join: the lobby, or the running match with the note that predictions start next phase (FR-400). */
function arrive(deps: JoinDeps, match: PublicMatch, player: PlayerCredentials): void {
  const next = afterJoin(match.stage);
  if (next.screen === 'lobby') return deps.onLobby(player);
  if (next.notice === undefined) return deps.onMatch(player);
  const card = openCard(STRINGS.joinedTitle, next.notice);
  personalBlock(card, deps.pageUrl, deps.matchId, player);
  button(card, STRINGS.joinedContinue, () => deps.onMatch(player), 'hud-btn primary');
}

/** The plain state of a match that is over or an expired lobby: a sentence, a way to watch it and a way to create another. */
export function showClosed(sentence: string, watch: (() => void) | undefined): void {
  const card = openCard(STRINGS.closedTitle, sentence);
  const row = h('div', 'hud-form', card);
  if (watch !== undefined) button(row, STRINGS.joinWatch, watch, 'hud-btn primary');
  const create = h('a', 'hud-btn', row);
  create.setAttribute('href', '?start');
  create.textContent = STRINGS.closedCreate;
}
