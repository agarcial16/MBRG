// Regenerates golden/service-timelines.json. A separate, reviewed step: the test never writes the golden.
// Run from the repository root:  npx tsx apps/server/test/golden/generate-service-timelines.ts
// The runs use an in-memory database and no restart; the tests check that file databases and restarts give the same.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SCENARIOS, T0 } from '../helpers/core-timelines';
import { runServiceScenario } from '../helpers/service-timelines';

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const out = {
  note: 'Service timelines of spec 008 (NFR-48 lifecycle goldens): the six core scenarios driven through the lifecycle service. Per scenario, the match id, the creation event and, per action, the stored rows, event types and numbers, anchors, stage, victim, record digest and public data digest; finally the digest of every stored event. Instants are absolute ms; T0 is the creation instant.',
  t0: T0,
  scenarios: Object.fromEntries(
    SCENARIOS.map((s) => {
      const run = runServiceScenario(s);
      return [s.name, { timing: s.timing, secret: s.secret, matchId: run.matchId, creation: run.creation, actions: run.summaries, eventsDigest: sha(JSON.stringify(run.final.events)) }];
    }),
  ),
};
writeFileSync(fileURLToPath(new URL('./service-timelines.json', import.meta.url)), JSON.stringify(out, null, 2) + '\n');
console.log('written');
