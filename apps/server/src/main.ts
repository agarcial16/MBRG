// Server entry point (spec 008). M1 runs under `tsx` (plan section 7) and only proves the platform:
// the workspace links to `@mbrg/sim` and `@mbrg/shared`, and the built-in `node:sqlite`. No HTTP yet.
import { installWarningFilter } from './warnings';

// Before the dynamic import of node:sqlite, whose load emits the ExperimentalWarning (NFR-53).
installWarningFilter();

const check = async (): Promise<void> => {
  const sim = await import('@mbrg/sim');
  const shared = await import('@mbrg/shared');
  const { DatabaseSync } = await import('node:sqlite');
  const exported = [sim.playRoundWithSeed, sim.absorptionCandidatesOf, sim.livingFactions, sim.getState];
  if (!exported.every((f) => typeof f === 'function')) throw new Error('@mbrg/sim exports are missing');
  if (Object.keys(shared).length === 0) throw new Error('@mbrg/shared exports are missing');
  const db = new DatabaseSync(':memory:');
  try {
    if (db.prepare('SELECT 1 AS one').get()?.one !== 1) throw new Error('node:sqlite does not answer');
  } finally {
    db.close();
  }
  console.log('check ok');
};

if (process.argv.includes('--check')) {
  await check();
}
