import { describe, expect, it } from 'vitest';
import { PREDICT_ID, START_ID, pickId } from '../src/core/custom-ids';
import type { ButtonSpec } from '../src/core/model';
import { EPHEMERAL, commandDefinitions, componentsOf, fromAutocomplete, fromButton, fromCommand, fromModal, fromSelect, messagePayload, modalPayload, replyPayload } from '../src/discord/translate';

describe('NFR-90 translation of Discord shapes', () => {
  it('NFR-90 a slash command becomes a core interaction with the manager flag and its text options', () => {
    expect(fromCommand('create', { map: 'europe', pace: 'fast' }, true)).toEqual({ type: 'create', canManage: true, map: 'europe', pace: 'fast' });
    expect(fromCommand('create', { map: 'europe' }, false)).toEqual({ type: 'create', canManage: false, map: 'europe', pace: undefined });
    expect(fromCommand('start', {}, true)).toEqual({ type: 'start', canManage: true });
    expect(fromCommand('stop', {}, false)).toEqual({ type: 'stop', canManage: false });
    expect(fromCommand('board', {}, false)).toEqual({ type: 'board' });
    expect(fromCommand('predict', { faction: null }, false)).toEqual({ type: 'predict', faction: undefined });
    expect(fromCommand('predict', { faction: 'fra' }, false)).toEqual({ type: 'predict', faction: 'fra' });
    expect(fromCommand('nope', {}, true)).toBeUndefined();
  });

  it('NFR-90 presses, menus, windows and autocomplete are read as their core interactions', () => {
    expect(fromButton(START_ID, true)).toEqual({ type: 'button', customId: START_ID, canManage: true });
    expect(fromSelect(pickId('victim', 2), ['5'])).toEqual({ type: 'select', customId: 'mbrg:pick:victim:2', values: ['5'] });
    expect(fromModal('mbrg:find:victim:2', 'fra')).toEqual({ type: 'modal', customId: 'mbrg:find:victim:2', text: 'fra' });
    expect(fromAutocomplete('map', 'eu')).toEqual({ type: 'autocomplete', option: 'map', text: 'eu' });
    expect(fromAutocomplete('faction', 'x')).toEqual({ type: 'autocomplete', option: 'faction', text: 'x' });
    expect(fromAutocomplete('other', 'x')).toBeUndefined();
  });
});

describe('NFR-91 Discord limits in payloads', () => {
  const custom = (i: number): ButtonSpec => ({ type: 'custom', customId: `mbrg:b${i}`, label: `b${i}`, style: 'primary' });

  it('NFR-91 buttons go in rows of at most five and a link button carries its address', () => {
    const rows = componentsOf([...Array.from({ length: 6 }, (_, i) => custom(i)), { type: 'link', url: 'https://v.example/', label: 'Ver' }]);
    expect(rows.map((r) => r.components.length)).toEqual([5, 2]);
    expect(rows[1]?.components[1]).toEqual({ type: 2, style: 5, label: 'Ver', url: 'https://v.example/' });
    expect(rows[0]?.components[0]).toMatchObject({ type: 2, style: 1, custom_id: 'mbrg:b0' });
  });

  it('NFR-91 a channel message pings nobody: the mentions show, nobody is notified', () => {
    const payload = messagePayload({ text: 'Hola <@42>', buttons: [{ type: 'custom', customId: PREDICT_ID, label: 'Predecir', style: 'primary' }] });
    expect(payload.allowedMentions).toEqual({ parse: [] });
    expect(payload.components).toHaveLength(1);
    expect(messagePayload({ text: 'solo texto', buttons: [] })).not.toHaveProperty('components');
  });

  it('NFR-91 a long reply is cut into messages of at most 2,000 characters, the buttons on the first', () => {
    const text = Array.from({ length: 120 }, (_, i) => `${i}. ${'x'.repeat(60)}`).join('\n');
    const parts = replyPayload({ type: 'channel', messages: [{ text, buttons: [{ type: 'custom', customId: START_ID, label: 'Iniciar', style: 'success' }] }] }, false);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.content.length).toBeLessThanOrEqual(2000);
    expect(parts[0]).toHaveProperty('components');
    expect(parts[1]).not.toHaveProperty('components');
  });

  it('NFR-91 a select menu offers at most 25 options and is marked for the member only', () => {
    const options = Array.from({ length: 25 }, (_, i) => ({ label: `F${i}`, value: String(i) }));
    const [payload] = replyPayload({ type: 'select', text: 'Elige', customId: pickId('victim', 1), placeholder: 'Facción', options }, true);
    expect(payload?.flags).toBe(EPHEMERAL);
    const menu = (payload as { components: { components: { options: unknown[]; custom_id: string; max_values: number }[] }[] }).components[0]?.components[0];
    expect(menu?.options).toHaveLength(25);
    expect(menu?.custom_id).toBe('mbrg:pick:victim:1');
    expect(menu?.max_values).toBe(1);
  });

  it('NFR-91 a text reply to a member is ephemeral and a public one is not', () => {
    expect(replyPayload({ type: 'text', text: 'hola' }, true)[0]?.flags).toBe(EPHEMERAL);
    expect(replyPayload({ type: 'text', text: 'hola' }, false)[0]).not.toHaveProperty('flags');
  });

  it('FR-454 the text window has one short required field', () => {
    const modal = modalPayload({ type: 'modal', customId: 'mbrg:find:victim:3', title: 'Buscar facción', label: 'Parte del nombre' });
    expect(modal.custom_id).toBe('mbrg:find:victim:3');
    expect(modal.components[0]?.components[0]).toMatchObject({ type: 4, custom_id: 'q', required: true, style: 1 });
  });

  it('FR-451 the slash command definition has the five subcommands and autocomplete on the map and the faction', () => {
    const [root] = commandDefinitions();
    expect(root?.name).toBe('mbrg');
    expect(root?.options.map((o) => o.name)).toEqual(['create', 'start', 'stop', 'board', 'predict']);
    const create = root?.options[0];
    expect(create?.options?.[0]).toMatchObject({ name: 'map', required: true, autocomplete: true });
    expect(root?.options[4]?.options?.[0]).toMatchObject({ name: 'faction', required: false, autocomplete: true });
    expect(root?.dm_permission).toBe(false);
  });
});
