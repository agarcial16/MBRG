// Regenerates golden/core-timelines.json. A separate, reviewed step: the test never writes the golden.
// Run from the repository root:  npx tsx apps/server/test/golden/generate-core-timelines.ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SCENARIOS, T0, runScenario } from '../helpers/core-timelines';

const out = {
  note: 'Core timelines of spec 008 (NFR-48 core timelines): per action, the stored rows, event types, anchors, stage, victim, record digest and public view digest. Instants are absolute ms; T0 is the creation instant.',
  t0: T0,
  scenarios: Object.fromEntries(SCENARIOS.map((s) => [s.name, { timing: s.timing, secret: s.secret, actions: runScenario(s).summaries }])),
};
writeFileSync(fileURLToPath(new URL('./core-timelines.json', import.meta.url)), JSON.stringify(out, null, 2) + '\n');
console.log('written');
