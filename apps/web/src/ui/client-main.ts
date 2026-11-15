// The web test client page (FR-310, development only, H7): stage, countdown and the revealed victim from the live core, a form
// to submit predictions, the player's stored predictions and results and the first page of the leaderboard. It has no map and no
// WebGL. The development credential is read ONLY here, from `VITE_MBRG_WEB_CREDENTIAL` (apps/web/.env.local, ignored by version
// control); this page is not a production build input, so the credential never reaches a production page.
import { isLocalId, playerIdOf, readEvent } from '@mbrg/protocol';
import type { PredictionKind, PublicMatch } from '@mbrg/protocol';
import { CLIENT_NAMESPACE, KINDS, draftFor, draftKey, factionChoices, leaderboardLine, ownLine, readFailedLine, refusedLine, resultLine, roundOf, submissionBody, submittedLine, totalLine } from '../core/client-form';
import type { Draft } from '../core/client-form';
import { chooseScene } from '../core/live-address';
import type { LiveModel } from '../core/live-model';
import { errorText } from '../core/live-text';
import { panelView } from '../core/live-view';
import type { FactionName } from '../core/live-view';
import { STRINGS, fillTemplate } from '../core/strings';
import { now } from './clock';
import { pageServerOrigin } from './live-config';
import { createLiveNet, createPredictionNet } from './live-net';
import type { MapFiles } from './live-net';
import { startRunner } from './live-runner';
import { after } from './live-timer';
import { requestId } from './web-crypto';

document.documentElement.setAttribute('data-mbrg-scene', 'client');

const root = document.getElementById('client') as HTMLElement;
root.style.cssText = 'font:14px/1.4 sans-serif;color:#1c1c1c;max-width:720px;margin:0 auto;padding:12px';

function block(tag: string, style = ''): HTMLElement {
  const el = document.createElement(tag);
  if (style !== '') el.style.cssText = style;
  root.append(el);
  return el;
}

function lines(el: HTMLElement, list: readonly string[]): void {
  el.replaceChildren(
    ...list.map((line) => {
      const row = document.createElement('div');
      row.textContent = line;
      return row;
    }),
  );
}

function field(label: string, control: HTMLElement): void {
  const row = block('label', 'display:flex;gap:8px;align-items:center;margin:4px 0');
  const text = document.createElement('span');
  text.textContent = label;
  text.style.minWidth = '9em';
  row.append(text, control);
}

function start(): void {
  block('h1', 'font-size:18px').textContent = STRINGS.clientTitle;
  const choice = chooseScene(window.location.search, false);
  if (choice.kind !== 'live') {
    const reason = choice.kind === 'message' ? choice.error : 'need-match';
    block('p').textContent = errorText(reason);
    return;
  }
  const matchId = choice.matchId;
  const credential = import.meta.env.VITE_MBRG_WEB_CREDENTIAL as string | undefined;
  const missing = credential === undefined || credential === '';
  const variable = 'VITE_MBRG_WEB_CREDENTIAL';
  if (missing) block('p', 'color:#9b1c1c').textContent = fillTemplate(STRINGS.clientNoCredential, { name: variable });

  const base = pageServerOrigin();
  const bound = fetch.bind(globalThis);
  const net = createPredictionNet({ base, fetch: bound, credential });

  const status = block('div', 'margin:8px 0;padding:8px;background:#e8e4d8');
  const player = document.createElement('input');
  player.type = 'text';
  player.value = 'p1';
  field(STRINGS.clientPlayerLabel, player);
  const kindSelect = document.createElement('select');
  const kindNames: Record<PredictionKind, string> = { victim: STRINGS.clientKindVictim, absorber: STRINGS.clientKindAbsorber, winner: STRINGS.clientKindWinner };
  for (const kind of KINDS) {
    const option = document.createElement('option');
    option.value = kind;
    option.textContent = kindNames[kind];
    kindSelect.append(option);
  }
  field(STRINGS.clientKindLabel, kindSelect);
  const factionSelect = document.createElement('select');
  field(STRINGS.clientFactionLabel, factionSelect);
  const submit = document.createElement('button');
  submit.type = 'button';
  submit.textContent = STRINGS.clientSubmit;
  submit.disabled = missing;
  root.append(submit);
  const message = block('div', 'margin:6px 0;min-height:1.4em');
  block('h2', 'font-size:15px').textContent = STRINGS.clientOwnTitle;
  const own = block('div');
  block('h2', 'font-size:15px').textContent = STRINGS.clientResultsTitle;
  const results = block('div');
  block('h2', 'font-size:15px').textContent = STRINGS.clientLeaderboardTitle;
  const board = block('div');

  let model: LiveModel | undefined;
  let factions: FactionName[] = [];
  const nameOf = (faction: number): string => factions.find((f) => f.id === faction)?.name ?? String(faction);
  let offered = '';
  let loaded = '';
  let draft: Draft | undefined;
  const kind = (): PredictionKind => kindSelect.value as PredictionKind;

  const reload = async (): Promise<void> => {
    const local = player.value;
    const [predictions, scored, top] = await Promise.all([
      net.ownPredictions(matchId, local),
      isLocalId(local) ? net.playerResults(matchId, playerIdOf(CLIENT_NAMESPACE, local)) : Promise.resolve(undefined),
      net.leaderboard(matchId),
    ]);
    lines(own, predictions.ok ? predictions.value.items.map((p) => ownLine(p, nameOf)) : [readFailedLine(predictions.outcome)]);
    lines(results, scored === undefined ? [] : scored.ok ? [totalLine(scored.value.total), ...scored.value.items.map((r) => resultLine(r, nameOf))] : [readFailedLine(scored.outcome)]);
    lines(board, top.ok ? top.value.items.map(leaderboardLine) : [readFailedLine(top.outcome)]);
  };

  /** The faction choices follow the model and the chosen kind; the select is rebuilt only when they change. */
  const offer = (): void => {
    if (model === undefined) return;
    const choices = factionChoices(model, kind());
    const signature = `${kind()}|${choices.join(',')}`;
    if (signature === offered) return;
    offered = signature;
    factionSelect.replaceChildren(
      ...choices.map((faction) => {
        const option = document.createElement('option');
        option.value = String(faction);
        option.textContent = nameOf(faction);
        return option;
      }),
    );
  };
  kindSelect.addEventListener('change', offer);
  player.addEventListener('change', () => void reload());

  submit.addEventListener('click', () => {
    void (async () => {
      if (model === undefined) return;
      const local = player.value;
      if (!isLocalId(local)) return void (message.textContent = STRINGS.clientBadPlayer);
      const faction = Number(factionSelect.value);
      if (factionSelect.value === '' || !Number.isInteger(faction)) return;
      const round = roundOf(model, kind());
      const body = submissionBody({ kind: kind(), round, faction, playerId: local, requestId: '' });
      draft = draftFor(draft, draftKey(body), requestId);
      const sent = await net.submit(matchId, { ...body, requestId: draft.requestId });
      if (sent.ok) {
        draft = undefined;
        message.textContent = submittedLine(sent.value, nameOf);
        await reload();
      } else {
        message.textContent = refusedLine(sent.outcome);
      }
    })();
  });

  const runner = startRunner({
    matchId,
    net: createLiveNet({ base, fetch: bound }),
    port: {
      open: async (match: PublicMatch, files: MapFiles) => {
        try {
          const presentation = JSON.parse(new TextDecoder().decode(files['presentation.json'])) as { factions?: { id: number; name: string }[] };
          factions = (presentation.factions ?? []).map((f) => ({ id: f.id, name: f.name }));
        } catch {
          factions = [];
        }
        return { ok: true, round: match.appliedRounds };
      },
      draw: () => undefined,
      playStep: () => undefined,
      startVictimTour: () => undefined,
      completeTour: () => undefined,
      show: (next, at) => {
        model = next;
        const view = panelView(next, at, factions);
        lines(status, [view.round ?? '', view.stage, view.countdown ?? '', view.victim ?? '', view.winner ?? '', view.halt ?? '', view.notice ?? ''].filter((x) => x !== ''));
        offer();
        const stamp = `${next.applied}|${next.stage}`;
        if (stamp !== loaded) {
          loaded = stamp;
          void reload();
        }
      },
      fail: (text) => lines(status, [text]),
    },
    now,
    after,
    onFrame: (data) => {
      const read = readEvent(data);
      if (read.status === 'known' && read.event.type === 'results') void reload();
    },
  });
  void runner;
}

start();
