import { afterEach, describe, expect, it, vi } from 'vitest';
import { STRINGS } from '../src/core/strings';
import { CREDENTIAL, startFake } from './helpers/fake-server';
import type { Fake } from './helpers/fake-server';
import { boot, manager, tempState } from './helpers/harness';
import type { Bot } from './helpers/harness';

// Spec 018 FR-505: `/mbrg create` creates the match client-only, with the `discord` credential as bearer; an older server that
// refuses the member is "the server is unavailable", and the bot never retries as an open match.

vi.setConfig({ testTimeout: 30_000 });

const fakes: Fake[] = [];
const bots: Bot[] = [];
const cleanups: (() => void)[] = [];
afterEach(async () => {
  for (const bot of bots.splice(0)) bot.stop();
  for (const fake of fakes.splice(0)) await fake.close();
  for (const clean of cleanups.splice(0)) clean();
});

async function world() {
  const fake = await startFake();
  fakes.push(fake);
  const state = tempState();
  cleanups.push(state.remove);
  const bot = boot(fake, state.path);
  bots.push(bot);
  return { fake, bot };
}
const creations = (fake: Fake) => fake.requests.filter((r) => r.method === 'POST' && r.path === '/matches');

describe('FR-505 the create command asks for a client-only match', () => {
  it('FR-505 the creation request carries joinPolicy client and the discord credential as bearer, and the match is followed', async () => {
    const { fake, bot } = await world();
    const reply = await bot.run(manager());
    expect(reply.type).toBe('channel');
    const sent = creations(fake);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.bearer).toBe(CREDENTIAL);
    expect(sent[0]!.body).toMatchObject({ mapId: 'europe', joinPolicy: 'client' });
    // The public reads and the start keep their credential rules: no bearer on a read, the host token on the start.
    expect(fake.requests.filter((r) => r.method === 'GET').every((r) => r.bearer === undefined)).toBe(true);
  });

  it('FR-505 an older server that refuses joinPolicy is reported as unavailable, with one creation request and nothing followed', async () => {
    const { fake, bot } = await world();
    fake.createError = { status: 400, body: { kind: 'invalid-request', items: ['joinPolicy'] } };
    const reply = await bot.run(manager());
    expect(reply).toMatchObject({ type: 'text', text: STRINGS.serverDown });
    expect(creations(fake)).toHaveLength(1);
    expect(fake.streamCount()).toBe(0);
    // A second command does not fall back to an open match either: still exactly one request per attempt, each with the member.
    await bot.run(manager());
    const sent = creations(fake);
    expect(sent).toHaveLength(2);
    for (const request of sent) expect(request.body).toMatchObject({ joinPolicy: 'client' });
  });

  it('FR-505 another refusal of the creation keeps its own sentence (only the joinPolicy refusal is the older server)', async () => {
    const { fake, bot } = await world();
    fake.createError = { status: 409, body: { kind: 'too-many-matches' } };
    const reply = await bot.run(manager());
    expect(reply.type).toBe('text');
    expect((reply as { text: string }).text).not.toBe(STRINGS.serverDown);
    expect(creations(fake)).toHaveLength(1);
  });
});
