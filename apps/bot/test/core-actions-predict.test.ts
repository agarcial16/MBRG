import type { PublicConfig, PublicMatch } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { decide, deliveryOf } from '../src/core/actions';
import type { Interaction } from '../src/core/actions';
import { PREDICT_ID, START_ID, findId, pickId } from '../src/core/custom-ids';
import { readConfig } from '../src/core/env';
import { nameBook } from '../src/core/names';
import { paceTiming } from '../src/core/paces';
import { chosenText, closedSentence, errorSentence, offerFor, openPhaseOf, resolveText, suggestionsFor } from '../src/core/predict';
import type { OpenPhase } from '../src/core/predict';

const matchOf = (over: Partial<PublicMatch> & { stage: PublicMatch['stage'] }, owners: number[] = [1, 2, 3]): PublicMatch =>
  ({
    matchId: 'm1', mapId: 'europe', mapDigest: 'a', totalRounds: 4, timing: { i: 60, l1: 30, l2: 5 }, commitment: 'a', appliedRounds: 1,
    state: { mode: 'classic', round: 1, owners: owners.map((f, i) => [i + 1, f] as const) }, stateDigest: 'a', lastSeq: 3, reportedTime: 1, ...over,
  }) as PublicMatch;

const victim = (candidates: number[], forced = false) => ({ round: 2, victim: 1, candidates, living: [1, 2, 3], revealedAt: 1, c2: null, a: null, ...(forced ? { forced: true as const } : {}), seq: 4 });
const open = (m: PublicMatch): Extract<OpenPhase, { open: true }> => {
  const p = openPhaseOf(m);
  if (!p.open) throw new Error('expected an open phase');
  return p;
};
const many = Array.from({ length: 120 }, (_, i) => i + 1);
const manyNames = nameBook(many.map((id) => ({ id, name: `Region ${id}` })));
const names = nameBook([{ id: 1, name: 'Alemania' }, { id: 2, name: 'España' }, { id: 3, name: 'Francia' }]);

describe('FR-452 who may start, stop and create', () => {
  const start: Interaction = { type: 'start', canManage: true };
  it('FR-452 a manager starts; anyone else is refused with a private sentence and nothing runs', () => {
    expect(decide(start, true)).toEqual({ do: 'start' });
    expect(decide({ type: 'start', canManage: false }, true)).toEqual({ do: 'say', text: 'Solo quien gestiona el canal puede hacer eso.' });
    expect(decide({ type: 'button', customId: START_ID, canManage: true }, true)).toEqual({ do: 'start' });
    expect(decide({ type: 'button', customId: START_ID, canManage: false }, true).do).toBe('say');
    expect(decide({ type: 'stop', canManage: false }, true).do).toBe('say');
  });

  it('FR-452 a channel that follows nothing cannot start or stop', () => {
    expect(decide(start, false)).toEqual({ do: 'say', text: 'Este canal no sigue ninguna partida.' });
    expect(decide({ type: 'stop', canManage: true }, false).do).toBe('say');
  });

  it('FR-451 create needs a manager, refuses a channel that already follows, and defaults to the normal pace', () => {
    expect(decide({ type: 'create', canManage: true, map: 'europe', pace: undefined }, false)).toEqual({ do: 'create', mapId: 'europe', pace: 'normal' });
    expect(decide({ type: 'create', canManage: true, map: 'europe', pace: 'fast' }, true).do).toBe('say');
    expect(decide({ type: 'create', canManage: false, map: 'europe', pace: 'fast' }, false).do).toBe('say');
    expect(decide({ type: 'create', canManage: true, map: 'europe', pace: 'warp' }, false)).toEqual({ do: 'say', text: 'Ese ritmo no existe.' });
  });

  it('FR-451 the pace stays inside the public bounds', () => {
    const config: PublicConfig = { maps: ['europe'], minInterval: 30, maxInterval: 3600, minPhase1: 10, minPhase2: 5, maxPlayers: 50, enabled: true };
    expect(paceTiming('fast', config)).toEqual({ i: 30, l1: 10, l2: 5 });
    expect(paceTiming('normal', config)).toEqual({ i: 60, l1: 30, l2: 5 });
    expect(paceTiming('slow', config)).toEqual({ i: 300, l1: 150, l2: 5 });
    // Where the bounds leave no room for the target, the pace falls back to the shortest timing.
    expect(paceTiming('slow', { ...config, maxInterval: 100, minPhase1: 60, minPhase2: 30 })).toEqual({ i: 30, l1: 60, l2: 30 });
  });
});

describe('FR-454 prediction flow', () => {
  it('FR-454 the open phase is the victim in phase 1 (living factions) and the absorber in phase 2 (its candidates)', () => {
    expect(openPhaseOf(matchOf({ stage: 'phase-1' }, [3, 1, 2, 1]))).toEqual({ open: true, kind: 'victim', round: 2, candidates: [1, 2, 3] });
    expect(openPhaseOf(matchOf({ stage: 'phase-2', victim: victim([2, 3]) }))).toEqual({ open: true, kind: 'absorber', round: 2, candidates: [2, 3] });
  });

  it('FR-454 nothing is open in the lobby, locked, finished, halted or expired, and a forced absorber has nothing to predict', () => {
    for (const [stage, reason] of [['lobby', 'not-started'], ['locked', 'closed'], ['finished', 'finished'], ['halted', 'halted'], ['expired', 'expired']] as const) {
      expect(openPhaseOf(matchOf({ stage }))).toEqual({ open: false, reason });
      expect(closedSentence(reason).length).toBeGreaterThan(5);
    }
    expect(openPhaseOf(matchOf({ stage: 'phase-2', victim: victim([3], true) }))).toEqual({ open: false, reason: 'forced' });
  });

  it('FR-454 25 candidates or fewer: a select menu with every candidate, the member only', () => {
    const reply = offerFor(open(matchOf({ stage: 'phase-1' }, many.slice(0, 25))), manyNames);
    expect(reply.type).toBe('select');
    if (reply.type === 'select') {
      expect(reply.options).toHaveLength(25);
      expect(reply.customId).toBe(pickId('victim', 2));
    }
  });

  it('FR-454 more than 25 candidates (100+ factions): the text window, never a list', () => {
    const reply = offerFor(open(matchOf({ stage: 'phase-1' }, many)), manyNames);
    expect(reply).toEqual({ type: 'modal', customId: findId('victim', 2), title: 'Buscar facción', label: 'Parte del nombre' });
  });

  it('FR-454 typed text: none matching says so, a single match is chosen at once, several give a menu of at most 25', () => {
    const o = open(matchOf({ stage: 'phase-1' }, many));
    expect(resolveText(o, manyNames, 'zzz')).toMatchObject({ type: 'none', reply: { type: 'text' } });
    expect(resolveText(o, manyNames, 'REGION 117')).toEqual({ type: 'one', faction: 117 });
    expect(resolveText(o, manyNames, '42')).toEqual({ type: 'one', faction: 42 });
    const several = resolveText(o, manyNames, 'region 1');
    expect(several.type).toBe('many');
    if (several.type === 'many' && several.reply.type === 'select') expect(several.reply.options.length).toBe(25);
    const small = open(matchOf({ stage: 'phase-1' }));
    expect(resolveText(small, names, 'espana')).toEqual({ type: 'one', faction: 2 });
  });

  it('FR-454 the command autocomplete gives at most 25 suggestions filtered by the typed text', () => {
    const all = suggestionsFor(many, manyNames, '');
    expect(all.type === 'suggest' && all.choices.length).toBe(25);
    const some = suggestionsFor(many, manyNames, 'region 11');
    expect(some.type === 'suggest' && some.choices[0]).toEqual({ name: 'Region 11', value: '11' });
    expect(chosenText(names, 2)).toBe('Elegido: España.');
  });

  it('FR-454 a press and a window are decided from the ids they carry', () => {
    expect(decide({ type: 'button', customId: PREDICT_ID, canManage: false }, true)).toEqual({ do: 'predict-open' });
    expect(decide({ type: 'predict', faction: undefined }, true)).toEqual({ do: 'predict-open' });
    expect(decide({ type: 'predict', faction: 'fran' }, true)).toEqual({ do: 'predict-text', text: 'fran' });
    expect(decide({ type: 'select', customId: pickId('absorber', 3), values: ['2'] }, true)).toEqual({ do: 'choose', kind: 'absorber', round: 3, faction: 2 });
    expect(decide({ type: 'select', customId: pickId('absorber', 3), values: ['x'] }, true).do).toBe('say');
    expect(decide({ type: 'modal', customId: findId('victim', 5), text: 'fra' }, true)).toEqual({ do: 'find', kind: 'victim', round: 5, text: 'fra' });
    expect(decide({ type: 'modal', customId: 'bad', text: 'fra' }, true).do).toBe('say');
    expect(decide({ type: 'autocomplete', option: 'faction', text: 'x' }, false)).toEqual({ do: 'suggest', option: 'faction', text: 'x' });
  });

  it('NFR-91 the work that calls the server is deferred; a press that may open a window is answered directly', () => {
    expect(deliveryOf({ do: 'create', mapId: 'europe', pace: 'fast' })).toBe('public');
    expect(deliveryOf({ do: 'choose', kind: 'victim', round: 1, faction: 1 })).toBe('private');
    expect(deliveryOf({ do: 'predict-open' })).toBe('direct');
    expect(deliveryOf({ do: 'suggest', option: 'map', text: '' })).toBe('direct');
  });
});

describe('FR-455 refusal sentences', () => {
  it('FR-455 a closed phase gets its own sentence and every other refusal a plain one', () => {
    expect(errorSentence({ kind: 'prediction-closed' })).toBe('La fase está cerrada. No se cambió nada.');
    expect(errorSentence({ kind: 'forced-absorber' })).toContain('forzado');
    expect(errorSentence({ kind: 'rate-limited', retryAfter: 7 })).toBe('Vas demasiado rápido. Espera 7 s.');
    expect(errorSentence({ kind: 'match-finished' })).toContain('terminó');
    expect(errorSentence({ kind: 'unavailable' })).toContain('no está disponible');
    expect(errorSentence({ kind: 'too-large' })).toContain('no aceptó');
  });
});

describe('NFR-89 configuration', () => {
  const full = { DISCORD_TOKEN: 'tok-secret', MBRG_SERVER_URL: 'http://x/', MBRG_DISCORD_CREDENTIAL: 'cred-secret', MBRG_BOT_STATE_FILE: 'state.json' };
  it('NFR-89 a missing variable is named, never a value', () => {
    const r = readConfig({ ...full, DISCORD_TOKEN: undefined, MBRG_BOT_STATE_FILE: ' ' });
    expect(r).toEqual({ ok: false, missing: ['DISCORD_TOKEN', 'MBRG_BOT_STATE_FILE'] });
    expect(JSON.stringify(r)).not.toContain('secret');
  });

  it('NFR-89 the optional viewer address and the trailing slash of the server address', () => {
    const r = readConfig(full);
    expect(r.ok && r.config.serverUrl).toBe('http://x');
    expect(r.ok && r.config.viewerUrl).toBeUndefined();
    expect(readConfig({ ...full, MBRG_VIEWER_URL: 'https://v/' }).ok).toBe(true);
  });
});
