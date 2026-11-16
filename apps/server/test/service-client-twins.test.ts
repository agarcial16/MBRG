import { encodePublicMatch } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { resultsReads } from './helpers/durability-script';
import { START_MS, creationBody, serviceHarness } from './helpers/service-harness';
import type { Harness } from './helpers/service-harness';

// Spec 018 NFR-101: the policy changes no draw and no round. Two creations with the same fake random source, one open and one
// client-only, run the same script and give the same match id, host token, commitment, records, states, events and results;
// the views differ only by `clientOnly`.

const CLIENT = { credential: 'client-credential-web-0123456789ab', namespace: 'web' } as const;

interface Run {
  readonly h: Harness;
  readonly matchId: string;
  readonly hostToken: string;
  readonly creationText: string;
}

const run = (clientOnly: boolean): Run => {
  const h = serviceHarness({ seed: 11, publicCreation: { maps: ['dev'] } });
  const made = h.service.createPublic({ source: 's', body: creationBody('c-1', clientOnly ? { joinPolicy: 'client' } : {}), client: CLIENT });
  if (!made.ok) throw new Error('creation failed');
  const { matchId, hostToken } = made.reply;
  expect(h.service.startMatch({ credential: hostToken, matchId, body: {} }).ok).toBe(true);
  const faction = h.service.publicMatch(matchId)!.state.owners[0]![1];
  for (const body of [
    { kind: 'winner', faction, playerId: 'p1', requestId: 'w-1' },
    { kind: 'victim', round: 1, faction, playerId: 'p1' },
    { kind: 'victim', round: 1, faction, playerId: 'p2' },
  ]) expect(h.service.submit({ client: CLIENT, matchId, body }).ok).toBe(true);
  for (let i = 0; i < 300; i++) {
    const shown = h.service.publicMatch(matchId)!;
    if (shown.stage === 'finished') break;
    const schedule = shown.schedule!;
    h.clock.set(shown.stage === 'phase-1' ? schedule.c1 : shown.stage === 'phase-2' ? schedule.c2 : schedule.a);
    h.service.tick();
  }
  expect(h.service.publicMatch(matchId)?.stage).toBe('finished');
  return { h, matchId, hostToken, creationText: JSON.stringify(made.reply) };
};
const strip = (text: string): string => text.replace(',"clientOnly":true', '').replace('"clientOnly":true,', '');

describe('the twin runs: open and client-only', () => {
  const open = run(false);
  const only = run(true);

  it('NFR-101 the draws are the same, in the same order and with the same lengths', () => {
    expect(only.h.draws.map((d) => [d.length, Buffer.from(d.bytes).toString('hex')])).toStrictEqual(open.h.draws.map((d) => [d.length, Buffer.from(d.bytes).toString('hex')]));
    // The creation draws the secret (32 bytes), then the match id and the host token, in the 011 order; nothing more for the policy.
    expect(only.h.draws.slice(0, 3).map((d) => d.length)).toStrictEqual(open.h.draws.slice(0, 3).map((d) => d.length));
    expect(only.h.draws.length).toBe(open.h.draws.length);
  });

  it('NFR-101 the match id, the host token and the commitment are the same', () => {
    expect(only.matchId).toBe(open.matchId);
    expect(only.hostToken).toBe(open.hostToken);
    expect(only.h.service.publicMatch(only.matchId)?.commitment).toBe(open.h.service.publicMatch(open.matchId)?.commitment);
    expect(strip(only.creationText)).toBe(open.creationText);
  });

  it('NFR-101 the records, the states, the events and the results are the same after a whole run', () => {
    const id = open.matchId;
    const stored = (r: Run) => ({
      records: r.h.store.records(id),
      steps: r.h.store.steps(id),
      events: r.h.store.eventsAfter(id, 0),
      states: Array.from({ length: 9 }, (_, round) => r.h.store.getState(id, round)),
      secret: Buffer.from(r.h.store.getMatch(id)!.secret).toString('hex'),
    });
    expect(stored(only)).toStrictEqual(stored(open));
    expect(resultsReads(only.h.service, id)).toBe(resultsReads(open.h.service, id));
    const events = (r: Run): string => JSON.stringify(r.h.service.eventsAfter(id, 0));
    expect(events(only)).toBe(events(open));
  });

  it('NFR-101 the views differ only by clientOnly, in the match read and in the list', () => {
    const id = open.matchId;
    const a = encodePublicMatch(only.h.service.publicMatch(id)!);
    const b = encodePublicMatch(open.h.service.publicMatch(id)!);
    expect(a).toContain('"clientOnly":true');
    expect(strip(a)).toBe(b);
    const listed = (r: Run) => r.h.service.listMatches({ limit: 10 });
    expect(JSON.stringify(listed(only))).toBe(JSON.stringify(listed(open)).replace(/("createdAt":\d+)/, '$1,"clientOnly":true'));
    expect(START_MS).toBeGreaterThan(0);
  });
});
