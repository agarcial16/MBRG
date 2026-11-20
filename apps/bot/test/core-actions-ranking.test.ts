import { describe, expect, it } from 'vitest';
import { decide, deliveryOf } from '../src/core/actions';
import type { Interaction } from '../src/core/actions';
import { STRINGS } from '../src/core/strings';
import { KEY_A } from './helpers/harness';

// Spec 025 FR-569 (the command part), FR-571 (the direct-message part): `/mbrg ranking` and its optional order word, decided by the pure core.

const NO_SERVER = Symbol('no server');
const ranking = (order: string | undefined, community: string | typeof NO_SERVER = KEY_A): Interaction => ({ type: 'ranking', community: community === NO_SERVER ? undefined : community, order });

describe('FR-569 the order words of the ranking command', () => {
  it('FR-569 each order word is mapped to the wire enum and the public ranking action carries the community key', () => {
    expect(decide(ranking('puntos'), false)).toEqual({ do: 'ranking', community: KEY_A, order: 'points' });
    expect(decide(ranking('aciertos'), false)).toEqual({ do: 'ranking', community: KEY_A, order: 'correct' });
    expect(decide(ranking('victorias'), false)).toEqual({ do: 'ranking', community: KEY_A, order: 'wins' });
    expect(decide(ranking('precisión'), false)).toEqual({ do: 'ranking', community: KEY_A, order: 'accuracy' });
  });

  it('FR-569 no order word means points; the word is read without case or surrounding spaces', () => {
    expect(decide(ranking(undefined), false)).toEqual({ do: 'ranking', community: KEY_A, order: 'points' });
    expect(decide(ranking('  Aciertos '), false)).toEqual({ do: 'ranking', community: KEY_A, order: 'correct' });
  });

  it('FR-569 a word that is not an order is one private sentence and no action; the wire words are not order words', () => {
    for (const word of ['', 'nada', 'points', 'wins', 'precision']) expect(decide(ranking(word), false), word).toEqual({ do: 'say', text: STRINGS.unknownOrder });
  });

  it('FR-569 the ranking is public and the same whether or not the channel follows a match', () => {
    const action = decide(ranking('victorias'), true);
    expect(action).toEqual({ do: 'ranking', community: KEY_A, order: 'wins' });
    expect(deliveryOf(action)).toBe('public');
  });
});

describe('FR-571 an interaction without a server', () => {
  it('FR-571 a ranking command with no server is refused with one sentence before the order is read, and nothing is asked of the server', () => {
    for (const order of [undefined, 'puntos', 'nada']) {
      const action = decide(ranking(order, NO_SERVER), false);
      expect(action, String(order)).toEqual({ do: 'say', text: STRINGS.noServer });
      expect(deliveryOf(action)).toBe('direct');
    }
  });
});
