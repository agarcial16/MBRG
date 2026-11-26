import { describe, expect, it } from 'vitest';
import { decide, deliveryOf } from '../src/core/actions';
import { appliedEmbed } from '../src/core/embeds';
import { readConfig } from '../src/core/env';
import type { OutMessage } from '../src/core/model';
import { STRINGS } from '../src/core/strings';
import { EPHEMERAL, commandDefinitions, fromCommand, messagePayload, replyPayload } from '../src/discord/translate';

const image = { name: 'round-3.png', data: new Uint8Array([137, 80, 78, 71]) };
const message: OutMessage = { text: 'Ronda 3', buttons: [], embed: appliedEmbed(3, 'Alemania', 'Francia', 4) };

describe('spec 038 image payloads (FR-717, FR-720)', () => {
  it('FR-717 an embed announcement with an image shows it through the attachment and carries the file; the embed spec itself has no image', () => {
    const payload = messagePayload({ ...message, image }, { mode: 'embed' }) as { embeds: { image?: { url: string } }[]; files: { name: string; attachment: Buffer }[]; content: string };
    expect(payload.embeds[0]?.image).toStrictEqual({ url: 'attachment://round-3.png' });
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0]?.name).toBe('round-3.png');
    expect([...payload.files[0]!.attachment]).toStrictEqual([137, 80, 78, 71]);
    // The same text (here none: the embed carries it) and nothing added by the bot.
    expect(payload.content).toBe('');
    expect(Object.keys(messagePayload(message, { mode: 'embed' }))).not.toContain('files');
    expect(JSON.stringify(messagePayload(message, { mode: 'embed' }))).not.toContain('attachment://');
  });

  it('FR-717 without Embed Links the plain announcement carries the image as a file, text unchanged', () => {
    const payload = messagePayload({ ...message, image }, { mode: 'text' }) as { content: string; files: { name: string }[]; embeds: unknown[] };
    expect(payload.content).toBe('Ronda 3');
    expect(payload.embeds).toStrictEqual([]);
    expect(payload.files.map((f) => f.name)).toStrictEqual(['round-3.png']);
  });

  it('FR-720 the map reply is a file only the member sees: private flag, no buttons, no text', () => {
    const [first, ...rest] = replyPayload({ type: 'image', image: { name: 'map-3.png', data: new Uint8Array([1, 2]) } }, true) as { files: { name: string }[]; content: string; flags: number; components?: unknown }[];
    expect(rest).toHaveLength(0);
    expect(first?.files.map((f) => f.name)).toStrictEqual(['map-3.png']);
    expect(first?.content).toBe('');
    expect(first?.flags).toBe(EPHEMERAL);
    expect(first?.components).toBeUndefined();
  });
});

describe('spec 038 map command (FR-720, FR-721)', () => {
  it('FR-720 the Spanish subcommand is registered once, with no option', () => {
    const [root] = commandDefinitions();
    const maps = root?.options.filter((o) => o.name === STRINGS.cmdMap) ?? [];
    expect(maps).toStrictEqual([{ type: 1, name: 'mapa', description: STRINGS.cmdMapText }]);
  });

  it('FR-720 the subcommand reads as a map interaction; the member alone sees the answer', () => {
    expect(fromCommand('mapa', {}, false, '9', '123')).toStrictEqual({ type: 'map' });
    const action = decide({ type: 'map' }, true);
    expect(action).toStrictEqual({ do: 'map' });
    expect(deliveryOf(action)).toBe('private');
  });

  it('FR-721 a channel that follows no match is told so, privately and by one sentence', () => {
    const action = decide({ type: 'map' }, false);
    expect(action).toStrictEqual({ do: 'say', text: STRINGS.notFollowing });
    expect(deliveryOf(action)).toBe('direct');
  });
});

describe('spec 038 configuration (FR-726)', () => {
  const base = { DISCORD_TOKEN: 't', MBRG_SERVER_URL: 'http://s', MBRG_DISCORD_CREDENTIAL: 'c', MBRG_BOT_STATE_FILE: 'state.json' };

  it('FR-726 the browser path is optional and read like the viewer address: blank is none', () => {
    const read = (extra: Record<string, string>) => {
      const result = readConfig({ ...base, ...extra });
      return result.ok ? result.config.chromePath : 'missing';
    };
    expect(read({})).toBeUndefined();
    expect(read({ MBRG_CHROME_PATH: '   ' })).toBeUndefined();
    expect(read({ MBRG_CHROME_PATH: ' /opt/chrome-headless-shell ' })).toBe('/opt/chrome-headless-shell');
  });
});
