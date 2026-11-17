import { encodePublicMatch } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { resultsReads } from './helpers/durability-script';
import { creationBody, serviceHarness } from './helpers/service-harness';
import type { Harness } from './helpers/service-harness';

// Spec 022 NFR-114: a display name changes no draw, no round and no read except the `name` member of scored rows. Two runs with
// the same fake random source and the same predictions, one without names and one with them, give the same match id, draws,
// events and views; every results read is equal once the name members are taken out.

const CLIENT = { credential: 'client-credential-web-0123456789ab', namespace: 'web' } as const;

const run = (names: boolean, clientOnly = true): { h: Harness; matchId: string } => {
  const h = serviceHarness({ seed: 11, publicCreation: { maps: ['dev'] } });
  const made = h.service.createPublic({ source: 's', body: creationBody('c-1', clientOnly ? { joinPolicy: 'client' } : {}), client: CLIENT });
  if (!made.ok) throw new Error('creation failed');
  const { matchId, hostToken } = made.reply;
  expect(h.service.startMatch({ credential: hostToken, matchId, body: {} }).ok).toBe(true);
  const faction = h.service.publicMatch(matchId)!.state.owners[0]![1];
  const named = (name: string): Record<string, unknown> => (names ? { name } : {});
  for (const body of [
    { kind: 'winner', faction, playerId: 'p1', requestId: 'w-1', ...named('Ana Lopez') },
    { kind: 'victim', round: 1, faction, playerId: 'p1', ...named('Ana Lopez') },
    { kind: 'victim', round: 1, faction, playerId: 'p2', ...named('Bea') },
  ]) expect(h.service.submit({ client: CLIENT, matchId, body }).ok).toBe(true);
  for (let i = 0; i < 300; i++) {
    const shown = h.service.publicMatch(matchId)!;
    if (shown.stage === 'finished') break;
    const schedule = shown.schedule!;
    h.clock.set(shown.stage === 'phase-1' ? schedule.c1 : shown.stage === 'phase-2' ? schedule.c2 : schedule.a);
    h.service.tick();
  }
  expect(h.service.publicMatch(matchId)?.stage).toBe('finished');
  return { h, matchId };
};
const unnamed = (text: string): string => text.replace(/,"name":"[^"]*"/g, '');

describe('NFR-114 the twin runs: without and with display names', () => {
  const plain = run(false);
  const named = run(true);

  it('the draws, the match id, the events and the match view are the same', () => {
    expect(named.matchId).toBe(plain.matchId);
    expect(named.h.draws.map((d) => [d.length, Buffer.from(d.bytes).toString('hex')])).toStrictEqual(plain.h.draws.map((d) => [d.length, Buffer.from(d.bytes).toString('hex')]));
    expect(JSON.stringify(named.h.service.eventsAfter(named.matchId, 0))).toBe(JSON.stringify(plain.h.service.eventsAfter(plain.matchId, 0)));
    expect(encodePublicMatch(named.h.service.publicMatch(named.matchId)!)).toBe(encodePublicMatch(plain.h.service.publicMatch(plain.matchId)!));
    expect(JSON.stringify(named.h.service.listMatches({ limit: 10 }))).toBe(JSON.stringify(plain.h.service.listMatches({ limit: 10 })));
  });

  it('every results read is equal once the name members are taken out, and only the named run has them', () => {
    const a = resultsReads(named.h.service, named.matchId);
    const b = resultsReads(plain.h.service, plain.matchId);
    expect(a).toContain('"name":"Ana Lopez"');
    expect(b).not.toContain('"name"');
    expect(unnamed(a)).toBe(b);
  });

  it('an open match with names behaves the same: the names add members only', () => {
    const open = run(true, false);
    const openPlain = run(false, false);
    expect(unnamed(resultsReads(open.h.service, open.matchId))).toBe(resultsReads(openPlain.h.service, openPlain.matchId));
    expect(JSON.stringify(open.h.service.eventsAfter(open.matchId, 0))).toBe(JSON.stringify(openPlain.h.service.eventsAfter(openPlain.matchId, 0)));
  });
});
