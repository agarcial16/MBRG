import { describe, expect, it } from 'vitest';
import { request } from './helpers/http-client';
import type { ClientReply } from './helpers/http-client';
import { CHILD_OPERATOR, baseEnv, eventsOf, withMain } from './helpers/main-child';

// Spec 024 NFR-118 (logs): a production process serving the history prints neither the community key nor the asker's player id, on
// any path of the read (served, malformed, a query text, a wrong credential, the operator, a rate-limited anonymous caller), and no
// refusal echoes them. The 008 log scan (`server-log-scan.test.ts`) is pinned by the secrecy suites, so the history session is its
// own file; it works as that scan does, with a real child process and its stdout and stderr.

describe('NFR-118 (logs) the log scan of the history', () => {
  it('NFR-118 (logs) a production process serving the history logs and prints neither the community key nor the asker id, and no reply echoes them', async () => {
    const CLIENT = 'child-client-credential-abcdef0123456789';
    const KEY = '5b4a9cc0ae55c9e5b4a9cc0ae55c9e5b4a9cc0ae55c9e5b4a9cc0ae55c9e5b4a';
    const ASKER = 'asker-planted-31337';
    const env = baseEnv({ MBRG_CLIENTS: JSON.stringify([{ namespace: 'discord', credential: CLIENT }]), MBRG_ALLOWED_ORIGINS: 'https://app.example', MBRG_LIMIT_ANONYMOUS: '4' });
    await withMain(env, async (child, port) => {
      const texts: string[] = [];
      const send = async (path: string, token: string | undefined, body: unknown): Promise<ClientReply> => {
        const reply = await request(port, { method: 'POST', path, body, ...(token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } }) });
        texts.push(`${reply.status}\n${JSON.stringify(reply.headers)}\n${reply.text}`);
        return reply;
      };
      const statuses = [
        (await send('/history', CLIENT, { community: KEY, playerId: ASKER })).status,
        (await send('/history', CLIENT, { community: KEY, playerId: ASKER, limit: 0 })).status,
        (await send('/history', CLIENT, { community: KEY, playerId: ASKER, extra: 1 })).status,
        (await send(`/history?community=${KEY}&playerId=${ASKER}`, CLIENT, { community: KEY, playerId: ASKER })).status,
        (await send('/history', CHILD_OPERATOR, { community: KEY, playerId: ASKER })).status,
        (await send('/history', 'nope-0123456789abcdefghij', { community: KEY, playerId: ASKER })).status,
      ];
      expect(statuses).toStrictEqual([200, 400, 400, 400, 403, 403]);
      for (let i = 0; i < 6; i += 1) statuses.push((await send('/history', undefined, { community: KEY, playerId: ASKER })).status);
      expect(statuses).toContain(429);
      const wire = texts.join('\n');
      const out = `${child.stdout()}\n${child.stderr()}`;
      for (const needle of [KEY, ASKER, CLIENT, CHILD_OPERATOR]) expect(out.includes(needle), `process output holds ${needle.slice(0, 12)}`).toBe(false);
      for (const needle of [KEY, ASKER]) expect(wire.includes(needle), `a reply holds ${needle.slice(0, 12)}`).toBe(false);
      expect(eventsOf(child.stdout()).map((e) => e.event)).toStrictEqual(['start-report', 'listening']);
      expect(child.stderr()).toBe('');
    });
  }, 120_000);
});
