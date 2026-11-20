import { describe, expect, it } from 'vitest';
import { decide, deliveryOf } from '../src/core/actions';
import type { Interaction } from '../src/core/actions';
import { PERIOD_WORDS, periodOf } from '../src/core/ranking';
import { STRINGS } from '../src/core/strings';
import { KEY_A } from './helpers/harness';

// Spec 027 FR-580 (the command part), FR-584: `/mbrg ranking` with an optional period word beside the order word, decided by the pure core.

const NO_SERVER = Symbol('no server');
const ranking = (order: string | undefined, period: string | undefined, community: string | typeof NO_SERVER = KEY_A): Interaction => ({
  type: 'ranking',
  community: community === NO_SERVER ? undefined : community,
  order,
  ...(period === undefined ? {} : { period }),
});

describe('FR-580 (command part) the period words of the ranking command', () => {
  it('FR-580 (command part) the words are semana and mes, in that order, and map to the wire periods last-7-days and last-30-days', () => {
    expect(PERIOD_WORDS).toEqual([
      ['semana', 'last-7-days'],
      ['mes', 'last-30-days'],
    ]);
    expect(periodOf('semana')).toBe('last-7-days');
    expect(periodOf('mes')).toBe('last-30-days');
  });

  it('FR-580 (command part) no word is all time; the word is read without case or surrounding spaces; a word that is not a period is nothing', () => {
    expect(periodOf(undefined)).toBe('all');
    expect(periodOf('  Semana ')).toBe('last-7-days');
    expect(periodOf('MES')).toBe('last-30-days');
    for (const word of ['', 'siempre', 'week', 'last-7-days', 'month', 'all', 'semanas']) expect(periodOf(word), word).toBeUndefined();
  });

  it('FR-580 (command part) each period word is carried by the public ranking action, in every order, and the order alone keeps the 025 action byte for byte', () => {
    expect(decide(ranking(undefined, 'semana'), false)).toEqual({ do: 'ranking', community: KEY_A, order: 'points', period: 'last-7-days' });
    expect(decide(ranking(undefined, 'mes'), false)).toEqual({ do: 'ranking', community: KEY_A, order: 'points', period: 'last-30-days' });
    expect(decide(ranking('victorias', 'semana'), false)).toEqual({ do: 'ranking', community: KEY_A, order: 'wins', period: 'last-7-days' });
    expect(decide(ranking('precisión', 'mes'), false)).toEqual({ do: 'ranking', community: KEY_A, order: 'accuracy', period: 'last-30-days' });
    expect(decide(ranking('aciertos', 'mes'), false)).toEqual({ do: 'ranking', community: KEY_A, order: 'correct', period: 'last-30-days' });
    // No word: the action holds no `period` key at all (not even undefined), so the all-time request is the 025 one.
    const plain = decide(ranking('puntos', undefined), false);
    expect(plain).toStrictEqual({ do: 'ranking', community: KEY_A, order: 'points' });
    expect(Object.keys(plain)).not.toContain('period');
  });

  it('FR-580 (command part) a word that is not a period is one private sentence and no action, and an order that is not one is still refused first', () => {
    for (const word of ['', 'nada', 'siempre', 'last-7-days']) expect(decide(ranking('puntos', word), false), word).toEqual({ do: 'say', text: STRINGS.unknownPeriod });
    expect(decide(ranking('nada', 'nada'), false)).toEqual({ do: 'say', text: STRINGS.unknownOrder });
  });

  it('FR-580 (command part) the ranking with a period is public and the same whether or not the channel follows a match', () => {
    const action = decide(ranking('victorias', 'mes'), true);
    expect(action).toEqual({ do: 'ranking', community: KEY_A, order: 'wins', period: 'last-30-days' });
    expect(deliveryOf(action)).toBe('public');
  });
});

describe('FR-584 an interaction without a server', () => {
  it('FR-584 a ranking command with a period and no server is refused with one sentence before the words are read, and nothing is asked of the server', () => {
    for (const [order, period] of [[undefined, undefined], ['puntos', 'semana'], ['nada', 'mes'], ['puntos', 'nada']] as const) {
      const action = decide(ranking(order, period, NO_SERVER), false);
      expect(action, `${order} ${period}`).toEqual({ do: 'say', text: STRINGS.noServer });
      expect(deliveryOf(action)).toBe('direct');
    }
  });
});
