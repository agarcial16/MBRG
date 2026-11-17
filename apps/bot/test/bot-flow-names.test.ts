import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PREDICT_ID, START_ID, pickId } from '../src/core/custom-ids';
import { CREDENTIAL, startFake } from './helpers/fake-server';
import type { Fake } from './helpers/fake-server';
import { CHANNEL, MANAGER, boot, manager, tempState, waitFor } from './helpers/harness';
import type { Bot } from './helpers/harness';
import { revealRound1 } from './helpers/journey';

// Spec 022 FR-537, FR-539, NFR-113: the bot sends the cleaned display name of the member with every prediction, picks up a change,
// sends nothing when nothing valid remains and keeps the name out of its logs, its state file and its messages.

vi.setConfig({ testTimeout: 30_000 });

const fakes: Fake[] = [];
const bots: Bot[] = [];
const cleanups: (() => void)[] = [];
afterEach(async () => {
  for (const bot of bots.splice(0)) bot.stop();
  for (const fake of fakes.splice(0)) await fake.close();
  for (const clean of cleanups.splice(0)) clean();
});

const PLANTED = 'Qxz Planted Member';
const userId = '123123123123123123';
const who = (displayName?: string): { channelId: string; userId: string; displayName?: string } => ({ channelId: CHANNEL, userId, ...(displayName === undefined ? {} : { displayName }) });

async function inPhase2(): Promise<{ fake: Fake; bot: Bot; statePath: string }> {
  const fake = await startFake({});
  fakes.push(fake);
  const state = tempState();
  cleanups.push(state.remove);
  const bot = boot(fake, state.path, {});
  bots.push(bot);
  expect((await bot.run(manager())).type).toBe('channel');
  await waitFor(() => fake.streamCount() === 1);
  await bot.run({ type: 'button', customId: START_ID, canManage: true, userId: MANAGER.userId });
  await waitFor(() => bot.posts.length === 1);
  revealRound1(fake);
  await waitFor(() => bot.posts.length === 3);
  return { fake, bot, statePath: state.path };
}
const sentBodies = (fake: Fake): Record<string, unknown>[] => fake.requests.filter((r) => r.path.endsWith('/predictions') && r.method === 'POST').map((r) => r.body as Record<string, unknown>);

describe('FR-537 the display name goes with every prediction', () => {
  it('a choice from the menu sends the cleaned name; an emoji-only name sends no name member', async () => {
    const { fake, bot } = await inPhase2();
    await bot.run({ type: 'button', customId: PREDICT_ID, canManage: false, userId }, who(`\u{1F525}${PLANTED}\u{1F525}`));
    await bot.run({ type: 'select', customId: pickId('absorber', 1), values: ['3'] }, who(`\u{1F525}${PLANTED}\u{1F525}`));
    await bot.run({ type: 'select', customId: pickId('absorber', 1), values: ['3'] }, who('\u{1F600}\u{1F525}'));
    await bot.run({ type: 'select', customId: pickId('absorber', 1), values: ['3'] }, who());
    const bodies = sentBodies(fake);
    expect(bodies).toHaveLength(3);
    expect(bodies[0]).toEqual({ kind: 'absorber', round: 1, faction: 3, playerId: userId, name: PLANTED });
    expect(bodies[1]).toEqual({ kind: 'absorber', round: 1, faction: 3, playerId: userId });
    expect(bodies[2]).toEqual({ kind: 'absorber', round: 1, faction: 3, playerId: userId });
    expect(fake.requests.filter((r) => r.path.endsWith('/predictions')).every((r) => r.bearer === CREDENTIAL)).toBe(true);
  });

  it('FR-539 a changed display name goes with the next prediction, and two members may share one', async () => {
    const { fake, bot } = await inPhase2();
    await bot.run({ type: 'select', customId: pickId('absorber', 1), values: ['3'] }, who('Old Name'));
    await bot.run({ type: 'select', customId: pickId('absorber', 1), values: ['2'] }, who('New Name'));
    await bot.run({ type: 'select', customId: pickId('absorber', 1), values: ['2'] }, { channelId: CHANNEL, userId: '555555555555555555', displayName: 'New Name' });
    expect(sentBodies(fake).map((b) => b.name)).toEqual(['Old Name', 'New Name', 'New Name']);
    expect(sentBodies(fake).map((b) => b.playerId)).toEqual([userId, userId, '555555555555555555']);
  });

  it('NFR-113 the name reaches no log line, no state file field and no message the bot posts or answers', async () => {
    const { fake, bot, statePath } = await inPhase2();
    const reply = await bot.run({ type: 'select', customId: pickId('absorber', 1), values: ['3'] }, who(PLANTED));
    expect(sentBodies(fake)[0]?.name).toBe(PLANTED);
    expect(JSON.stringify(reply)).not.toContain('Planted');
    expect(JSON.stringify(bot.posts)).not.toContain('Planted');
    expect(JSON.stringify(bot.edits)).not.toContain('Planted');
    expect(bot.logs.join('\n')).not.toContain('Planted');
    expect(readFileSync(statePath, 'utf8')).not.toContain('Planted');
  });

  it('NFR-113 a server that refuses the name answers the member the generic sentence and the bot does not retry without it', async () => {
    const { fake, bot } = await inPhase2();
    fake.submitError = { status: 400, body: { kind: 'invalid-request', items: ['name'] } };
    const reply = await bot.run({ type: 'select', customId: pickId('absorber', 1), values: ['3'] }, who(PLANTED));
    expect(reply.type).toBe('text');
    expect(JSON.stringify(reply)).not.toContain('Planted');
    expect(sentBodies(fake)).toHaveLength(1);
  });
});

describe('NFR-113 the sources of the bot keep the name out of logs and state', () => {
  const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const files: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(d, entry.name));
      else if (entry.name.endsWith('.ts')) files.push(join(d, entry.name));
    }
  };
  walk(src);

  it('NFR-113 displayName is read only by the handler, the shell and the translation, and never next to a log call or the state store', () => {
    const users = files.filter((f) => /displayName/.test(readFileSync(f, 'utf8'))).map((f) => f.slice(src.length + 1).replaceAll('\\', '/')).sort();
    expect(users).toStrictEqual(['discord/shell.ts', 'discord/translate.ts', 'io/handler.ts']);
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/log[A-Za-z]*\([^)]*(displayName|\.name\b)/);
    }
    const handler = readFileSync(join(src, 'io', 'handler.ts'), 'utf8');
    expect(handler).not.toMatch(/store\.set\([^)]*(displayName|cleanDisplayName)/);
  });
});
