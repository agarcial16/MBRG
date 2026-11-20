import { describe, expect, it } from 'vitest';
import { commandDefinitions, fromCommand } from '../src/discord/translate';
import { GUILD_A, KEY_A } from './helpers/harness';

// Spec 027 FR-580 (the command part), FR-584: the ranking command as Discord registers it and as it is translated, with the period option.

type Sub = { name: string; options?: { name: string; required?: boolean; type: number; description?: string; choices?: { name: string; value: string }[] }[] };
const rankingSub = (): Sub => (commandDefinitions()[0]!.options as Sub[]).find((s) => s.name === 'ranking')!;

describe('FR-580 (command part) the registered ranking subcommand', () => {
  it('FR-580 (command part) it has exactly two optional text options, order then period, and no other', () => {
    const options = rankingSub().options!;
    expect(options.map((o) => o.name)).toEqual(['order', 'period']);
    for (const option of options) expect(option).toMatchObject({ type: 3, required: false });
  });

  it('FR-580 (command part) the period option offers semana and mes and nothing else (no "siempre": no word is all time)', () => {
    const period = rankingSub().options![1]!;
    expect(period.choices).toEqual([
      { name: 'semana', value: 'semana' },
      { name: 'mes', value: 'mes' },
    ]);
    expect(period.description).toBe('Periodo del ranking');
    expect(period).not.toHaveProperty('autocomplete');
  });

  it('FR-584 the command stays unavailable in direct messages and no other subcommand gained an option', () => {
    expect(commandDefinitions().every((c) => c.dm_permission === false)).toBe(true);
    const subs = commandDefinitions()[0]!.options as Sub[];
    expect(subs.filter((s) => s.name !== 'ranking' && s.name !== 'create' && s.name !== 'predict').every((s) => s.options === undefined)).toBe(true);
  });
});

describe('FR-580 (command part) FR-584 the translation of the ranking command', () => {
  it('FR-580 (command part) the period word travels as typed beside the order word; no word, or null, adds no member at all', () => {
    expect(fromCommand('ranking', { order: 'victorias', period: 'semana' }, false, '42', GUILD_A)).toStrictEqual({ type: 'ranking', community: KEY_A, order: 'victorias', period: 'semana' });
    expect(fromCommand('ranking', { period: 'mes' }, false, '42', GUILD_A)).toStrictEqual({ type: 'ranking', community: KEY_A, order: undefined, period: 'mes' });
    expect(fromCommand('ranking', { order: 'puntos', period: null }, false, '42', GUILD_A)).toStrictEqual({ type: 'ranking', community: KEY_A, order: 'puntos' });
    expect(fromCommand('ranking', {}, false, '42', GUILD_A)).toStrictEqual({ type: 'ranking', community: KEY_A, order: undefined });
  });

  it('FR-584 NFR-118 the raw guild id never reaches the interaction, with or without a period; without a server there is no key', () => {
    expect(JSON.stringify(fromCommand('ranking', { period: 'mes', order: 'puntos' }, false, '42', GUILD_A))).not.toContain(GUILD_A);
    expect(fromCommand('ranking', { period: 'semana' }, true, '42', null)).toStrictEqual({ type: 'ranking', community: undefined, order: undefined, period: 'semana' });
    expect(fromCommand('ranking', { period: 'semana' }, true, '42')).toStrictEqual({ type: 'ranking', community: undefined, order: undefined, period: 'semana' });
  });
});
