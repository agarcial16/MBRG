import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { MatchEvent } from '@mbrg/protocol';
import { SCENARIOS } from './core-timelines';
import { DEV_DIR } from './digests';
import { OPERATOR, creationBody, serviceHarness, withTempDir, writeMapPackage } from './service-harness';
import { runServiceScenario } from './service-timelines';

/**
 * The events stored by scripted dev-map matches (M3b T2): the six core scenarios (clock timing with L2 > 0 and L2 = 0,
 * manual timing, mid-round advances, a forward and a backward jump) run through the service, and one match halted by a
 * map package that lost its `map.json`. Used to check the encoder against real stored events; no assertion here.
 */
export function scriptedMatchEvents(): MatchEvent[] {
  const events: MatchEvent[] = [];
  for (const scenario of SCENARIOS) events.push(...runServiceScenario(scenario).final.events);
  withTempDir((dir) => {
    const folder = writeMapPackage(dir, 'pkg', readFileSync(join(DEV_DIR, 'map.json'), 'utf8'));
    const h = serviceHarness({ folders: { dev: folder }, scheduler: true });
    const created = h.service.create({ credential: OPERATOR, body: creationBody('c-1') });
    if (!created.ok) throw new Error('creation failed');
    rmSync(join(folder, 'map.json'));
    h.service.advance({ credential: OPERATOR, matchId: created.reply.matchId, body: { round: 1, step: 'phase-1-close' } });
    events.push(...h.store.eventsAfter(created.reply.matchId, 0));
    h.close();
  });
  return events;
}
