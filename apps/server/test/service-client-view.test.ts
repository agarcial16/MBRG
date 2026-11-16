import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePublicMatch } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { creationBody, serviceHarness } from './helpers/service-harness';
import type { Harness } from './helpers/service-harness';

// Spec 018 FR-501: every public view and list item of a client-only match carries `clientOnly: true`, and the view of an open
// match keeps its exact bytes. The fixture marks a public lobby client-only straight through the store (the creation path
// that does it is the next task), so the views are tested apart from the creation.

const harness = (): Harness => serviceHarness({ publicCreation: { maps: ['dev'] } });

const lobbyOf = (h: Harness, requestId: string, clientOnly: boolean): { matchId: string; hostToken: string } => {
  const out = h.service.createPublic({ source: `src-${requestId}`, body: creationBody(requestId) });
  if (!out.ok) throw new Error('public creation failed');
  if (clientOnly) h.store.transaction(() => h.store.insertClientMatch(out.reply.matchId, 'discord'));
  return { matchId: out.reply.matchId, hostToken: out.reply.hostToken };
};

describe('views of a client-only match', () => {
  it('FR-501 the match read, the list, the start reply and the advance replies carry clientOnly true; an open match keeps its bytes', () => {
    const h = harness();
    const open = lobbyOf(h, 'o-1', false);
    const only = lobbyOf(h, 'c-1', true);
    const view = (id: string) => {
      const out = h.service.readPublicMatch(id);
      if (!out.ok) throw new Error('read failed');
      return out.reply;
    };
    expect(view(only.matchId).clientOnly).toBe(true);
    expect(h.service.publicMatch(only.matchId)?.clientOnly).toBe(true);
    expect('clientOnly' in view(open.matchId)).toBe(false);
    expect(encodePublicMatch(view(only.matchId))).toContain('"clientOnly":true');
    expect(encodePublicMatch(view(open.matchId))).not.toContain('clientOnly');

    const list = h.service.listMatches({ limit: 10 });
    expect(list.ok && list.reply.items.map((i) => [i.matchId, i.clientOnly])).toStrictEqual([[open.matchId, undefined], [only.matchId, true]]);

    const started = h.service.startMatch({ credential: only.hostToken, matchId: only.matchId, body: {} });
    expect(started.ok && started.reply.match.clientOnly).toBe(true);
    expect(started.ok && started.reply.match.stage).toBe('phase-1');

    // The advance replies are built by the core: the performed and the already-performed ones are flagged by the service.
    const advance = { credential: only.hostToken, matchId: only.matchId, body: { round: 1, step: 'phase-1-close' } };
    const performed = h.service.advance(advance);
    expect(performed.ok && performed.reply.result).toBe('performed');
    expect(performed.ok && performed.reply.match.clientOnly).toBe(true);
    const again = h.service.advance(advance);
    expect(again.ok && again.reply.result).toBe('already-performed');
    expect(again.ok && again.reply.match.clientOnly).toBe(true);
    h.close();
  });

  it('FR-501 a started open match keeps the exact bytes: no clientOnly member in the match read, the list, the start and the advance replies', () => {
    const h = harness();
    const open = lobbyOf(h, 'o-1', false);
    const started = h.service.startMatch({ credential: open.hostToken, matchId: open.matchId, body: {} });
    const performed = h.service.advance({ credential: open.hostToken, matchId: open.matchId, body: { round: 1, step: 'phase-1-close' } });
    const texts = [
      JSON.stringify(started.ok && started.reply.match),
      JSON.stringify(performed.ok && performed.reply.match),
      JSON.stringify(h.service.publicMatch(open.matchId)),
      JSON.stringify(h.service.listMatches({ limit: 10 })),
    ];
    for (const text of texts) expect(text).not.toContain('clientOnly');
    h.close();
  });
});

describe('every public view is built through the flag', () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));
  const code = (file: string): string => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('FR-501 service/ calls publicOf only inside publicView, and every publicView call names the flag', () => {
    const service = files(join(SRC, 'service')).map((f) => code(f)).join('\n');
    expect([...service.matchAll(/\bpublicOf\(/g)]).toHaveLength(1);
    const calls = service.split('\n').filter((l) => /\bpublicView\(/.test(l) && !/const publicView/.test(l));
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call, call).toMatch(/flagOf\(|clientOnly|, false\)/);
  });

  it('FR-501 the only views built outside service/ are the advance replies of the core, flagged by the service', () => {
    const outside = files(join(SRC, 'core')).filter((f) => /publicOf\(/.test(code(f)) && !f.endsWith('view.ts')).map((f) => f.slice(SRC.length + 1).replace(/\\/g, '/'));
    expect(outside).toStrictEqual(['core/advance.ts']);
    const service = code(join(SRC, 'service', 'matches.ts'));
    expect(service).toMatch(/flagged\(/);
  });
});
