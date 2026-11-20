import { describe, expect, it } from 'vitest';
import { PREDICT_ID, START_ID, pickId } from '../src/core/custom-ids';
import type { ButtonSpec } from '../src/core/model';
import { EPHEMERAL, commandDefinitions, componentsOf, embedPayload, fromAutocomplete, fromBoardButton, fromButton, fromCommand, fromModal, fromSelect, messagePayload, modalPayload, replyPayload, withButtonsDisabled } from '../src/discord/translate';
import type { OutMessage } from '../src/core/model';
import { communityKey } from '../src/io/community';
import { GUILD_A, GUILD_B, KEY_A, KEY_B } from './helpers/harness';

describe('NFR-90 translation of Discord shapes', () => {
  it('NFR-90 a slash command becomes a core interaction with the manager flag and its text options', () => {
    expect(fromCommand('create', { map: 'europe', pace: 'fast' }, true, '42', GUILD_A)).toEqual({ type: 'create', canManage: true, map: 'europe', pace: 'fast', community: KEY_A });
    expect(fromCommand('create', { map: 'europe' }, false, '42', GUILD_A)).toEqual({ type: 'create', canManage: false, map: 'europe', pace: undefined, community: KEY_A });
    expect(fromCommand('start', {}, true, '42')).toEqual({ type: 'start', canManage: true, userId: '42' });
    expect(fromCommand('stop', {}, false, '42')).toEqual({ type: 'stop', canManage: false });
    expect(fromCommand('board', {}, false, '42')).toEqual({ type: 'board' });
    expect(fromCommand('predict', { faction: null }, false, '42')).toEqual({ type: 'predict', faction: undefined });
    expect(fromCommand('predict', { faction: 'fra' }, false, '42')).toEqual({ type: 'predict', faction: 'fra' });
    expect(fromCommand('nope', {}, true, '42')).toBeUndefined();
  });

  it('NFR-90 presses, menus, windows and autocomplete are read as their core interactions', () => {
    expect(fromButton(START_ID, true, '42')).toEqual({ type: 'button', customId: START_ID, canManage: true, userId: '42' });
    expect(fromSelect(pickId('victim', 2), ['5'])).toEqual({ type: 'select', customId: 'mbrg:pick:victim:2', values: ['5'] });
    expect(fromModal('mbrg:find:victim:2', 'fra')).toEqual({ type: 'modal', customId: 'mbrg:find:victim:2', text: 'fra' });
    expect(fromAutocomplete('map', 'eu')).toEqual({ type: 'autocomplete', option: 'map', text: 'eu' });
    expect(fromAutocomplete('faction', 'x')).toEqual({ type: 'autocomplete', option: 'faction', text: 'x' });
    expect(fromAutocomplete('other', 'x')).toBeUndefined();
  });
});

describe('FR-548 the community key', () => {
  it('FR-548 the key is the lowercase hexadecimal SHA-256 of the guild id text: a pinned vector, stable, one per server', () => {
    // Independent vector: sha256 of the ASCII text "123456789012345678" (computed outside the code under test).
    expect(communityKey('123456789012345678')).toBe('37f96542b663971bfdf6b7785174b7255d9aa320fa3455a5b4fa7b079427cf97');
    expect(communityKey(GUILD_A)).toBe(KEY_A);
    expect(communityKey(GUILD_B)).toBe(KEY_B);
    expect(communityKey(GUILD_A)).toBe(communityKey(GUILD_A));
    for (const key of [KEY_A, KEY_B]) expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(KEY_A).not.toBe(KEY_B);
  });

  it('FR-548 NFR-118 the interaction holds the key and never the raw guild id; a command with no guild has no key', () => {
    for (const sub of ['create', 'start', 'stop', 'board', 'predict']) {
      const interaction = fromCommand(sub, { map: 'europe', pace: 'fast', faction: 'fra' }, true, '42', GUILD_A);
      expect(JSON.stringify(interaction), sub).not.toContain(GUILD_A);
    }
    expect(JSON.stringify(fromCommand('create', { map: 'europe' }, true, '42', GUILD_A))).toContain(KEY_A);
    expect(fromCommand('create', { map: 'europe' }, true, '42', null)).toEqual({ type: 'create', canManage: true, map: 'europe', pace: undefined, community: undefined });
    expect(fromCommand('create', { map: 'europe' }, true, '42')).toMatchObject({ community: undefined });
  });

  it('FR-554 FR-548 the history command carries the key of its server and nothing else; without a server it has none', () => {
    expect(fromCommand('history', {}, false, '42', GUILD_A)).toEqual({ type: 'history', community: KEY_A });
    expect(JSON.stringify(fromCommand('history', {}, false, '42', GUILD_A))).not.toContain(GUILD_A);
    expect(fromCommand('history', {}, true, '42', null)).toEqual({ type: 'history', community: undefined });
    expect(fromCommand('history', {}, true, '42')).toEqual({ type: 'history', community: undefined });
  });

  it('FR-569 FR-548 the ranking command carries the key of its server and the order word as typed, and nothing else; without a server it has no key', () => {
    expect(fromCommand('ranking', {}, false, '42', GUILD_A)).toEqual({ type: 'ranking', community: KEY_A, order: undefined });
    expect(fromCommand('ranking', { order: null }, false, '42', GUILD_A)).toEqual({ type: 'ranking', community: KEY_A, order: undefined });
    expect(fromCommand('ranking', { order: 'victorias' }, false, '42', GUILD_A)).toEqual({ type: 'ranking', community: KEY_A, order: 'victorias' });
    expect(JSON.stringify(fromCommand('ranking', { order: 'puntos' }, false, '42', GUILD_A))).not.toContain(GUILD_A);
    expect(fromCommand('ranking', { order: 'puntos' }, true, '42', null)).toEqual({ type: 'ranking', community: undefined, order: 'puntos' });
    expect(fromCommand('ranking', {}, true, '42')).toEqual({ type: 'ranking', community: undefined, order: undefined });
  });

  it('FR-569 the registered ranking subcommand has the optional order option (spec 027 adds the period option after it, tested in its own file) whose four choices are the order words', () => {
    const root = commandDefinitions()[0]!;
    const subs = root.options as { name: string; options?: { name: string; required?: boolean; type: number; choices?: { name: string; value: string }[] }[] }[];
    const ranking = subs.filter((s) => s.name === 'ranking');
    expect(ranking).toHaveLength(1);
    expect(ranking[0]!.options).toHaveLength(2);
    expect(ranking[0]!.options![0]).toMatchObject({ name: 'order', type: 3, required: false });
    expect(ranking[0]!.options![0]!.choices).toEqual([
      { name: 'puntos', value: 'puntos' },
      { name: 'aciertos', value: 'aciertos' },
      { name: 'victorias', value: 'victorias' },
      { name: 'precisión', value: 'precisión' },
    ]);
  });

  it('FR-557 the registered command stays unavailable in direct messages', () => {
    expect(commandDefinitions().every((c) => c.dm_permission === false)).toBe(true);
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

  it('FR-451 FR-554 FR-569 the slash command definition has the seven subcommands (history added by spec 024, ranking by spec 025) and autocomplete on the map and the faction', () => {
    const [root] = commandDefinitions();
    expect(root?.name).toBe('mbrg');
    expect(root?.options.map((o) => o.name)).toEqual(['create', 'start', 'stop', 'board', 'predict', 'history', 'ranking']);
    expect(root?.options[5]).toEqual({ type: 1, name: 'history', description: 'Muestra las partidas terminadas de este servidor' });
    const create = root?.options[0];
    expect(create?.options?.[0]).toMatchObject({ name: 'map', required: true, autocomplete: true });
    expect(root?.options[4]?.options?.[0]).toMatchObject({ name: 'faction', required: false, autocomplete: true });
    expect(root?.dm_permission).toBe(false);
  });
});

describe('spec 017 embeds in payloads', () => {
  const embedMessage: OutMessage = {
    text: 'Ronda 1 abierta.',
    embed: { color: 7, title: 'Ronda 1 abierta', description: 'Hola <@42>', fields: [{ name: 'Victima', value: '**A**' }], footer: 'Pagina 1/2' },
    buttons: [{ type: 'custom', customId: PREDICT_ID, label: 'Predecir', style: 'primary' }],
  };

  it('FR-472 an embed goes with its color, fields and footer and no image of any kind: no thumbnail, image, video or map', () => {
    const e = embedPayload(embedMessage.embed as NonNullable<OutMessage['embed']>);
    expect(e).toEqual({ title: 'Ronda 1 abierta', color: 7, description: 'Hola <@42>', fields: [{ name: 'Victima', value: '**A**' }], footer: { text: 'Pagina 1/2' } });
    expect(embedPayload({ color: 1, title: 't', fields: [] })).toEqual({ title: 't', color: 1 });
    expect(Object.keys(e)).not.toContain('image');
    expect(Object.keys(e)).not.toContain('video');
    expect(Object.keys(e)).not.toContain('thumbnail');
  });

  it('FR-472 in embed mode the message is the embed and its buttons, with the text cleared; mentions never ping (NFR-94)', () => {
    const p = messagePayload(embedMessage, { mode: 'embed' });
    expect(p.content).toBe('');
    expect(p.embeds).toHaveLength(1);
    expect(p.allowedMentions).toEqual({ parse: [] });
    expect(p.components).toHaveLength(1);
  });

  it('FR-475 without Embed Links the same message is the plain text of 012 and an edit clears any embed', () => {
    const p = messagePayload(embedMessage, { mode: 'text' });
    expect(p.content).toBe('Ronda 1 abierta.');
    expect(p.embeds).toEqual([]);
    expect(p.components).toHaveLength(1);
    expect(messagePayload({ text: 'plain', buttons: [] })).not.toHaveProperty('embeds');
  });

  it('NFR-94 an embed over the Discord limits is cut before it is sent', () => {
    const e = embedPayload({ color: 1, title: 't'.repeat(999), description: 'd'.repeat(9000), fields: Array.from({ length: 30 }, () => ({ name: 'n', value: 'v'.repeat(3000) })) });
    expect(e.title.length).toBeLessThanOrEqual(256);
    expect((e.description ?? '').length).toBeLessThanOrEqual(4096);
    expect((e.fields ?? []).length).toBeLessThanOrEqual(25);
    for (const f of e.fields ?? []) expect(f.value.length).toBeLessThanOrEqual(1024);
  });

  it('FR-477 a channel reply in embed mode is one payload (an embed is not split) and private when asked', () => {
    const parts = replyPayload({ type: 'channel', messages: [embedMessage] }, true, { mode: 'embed' });
    expect(parts).toHaveLength(1);
    expect(parts[0]?.flags).toBe(EPHEMERAL);
    expect(parts[0]).toHaveProperty('embeds');
  });

  it('FR-481 disabling the buttons of a message sets every button disabled and leaves the rest', () => {
    const rows = [{ type: 1, components: [{ type: 2, style: 1, custom_id: 'a', label: 'A' }, { type: 2, style: 5, url: 'https://v.example/', label: 'V' }] }];
    const out = withButtonsDisabled(rows);
    expect(out[0]?.components).toEqual([{ type: 2, style: 1, custom_id: 'a', label: 'A', disabled: true }, { type: 2, style: 5, url: 'https://v.example/', label: 'V', disabled: true }]);
    expect(rows[0]?.components[0]).not.toHaveProperty('disabled');
  });

  it('FR-480 a press on a leaderboard button carries the user, what the shell knows of the message, and the time', () => {
    expect(fromBoardButton('mbrg:bd:n:2', '42', undefined, 9)).toEqual({ type: 'board-press', customId: 'mbrg:bd:n:2', userId: '42', entry: undefined, now: 9 });
  });
});
