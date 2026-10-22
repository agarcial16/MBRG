// Server entry point (spec 008). Runs under `tsx` (plan section 7). `--check` proves the platform: the workspace links to
// `@mbrg/sim` and `@mbrg/shared`, and the store (the only user of `node:sqlite`). Without it, the entry point builds the
// lifecycle service from the SETTINGS alone (FR-260, NFR-47 (f)): it passes no round-seed source and reads no variable
// that could set one. No HTTP yet.
import { systemClock } from './clock';
import { createMapCatalog } from './service/maps';
import { createMatchService } from './service/matches';
import { readSettings } from './service/settings';
import { installWarningFilter } from './warnings';

// Before the dynamic import of the store, whose load of node:sqlite emits the ExperimentalWarning (NFR-53).
installWarningFilter();

const check = async (): Promise<void> => {
  const sim = await import('@mbrg/sim');
  const shared = await import('@mbrg/shared');
  const { openStore } = await import('./store/sqlite');
  const exported = [sim.playRoundWithSeed, sim.absorptionCandidatesOf, sim.livingFactions, sim.getState];
  if (!exported.every((f) => typeof f === 'function')) throw new Error('@mbrg/sim exports are missing');
  if (Object.keys(shared).length === 0) throw new Error('@mbrg/shared exports are missing');
  const store = openStore(':memory:');
  try {
    if (store.settings().userVersion !== 1) throw new Error('the store did not create schema version 1');
  } finally {
    store.close();
  }
  console.log('check ok');
};

const start = async (): Promise<void> => {
  const read = readSettings(process.env);
  if (!read.ok) {
    console.error(`invalid settings: ${read.problems.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  const { openStore } = await import('./store/sqlite');
  const store = openStore(read.settings.databasePath);
  try {
    createMatchService({ store, clock: systemClock, maps: createMapCatalog(read.settings.maps), settings: read.settings });
    console.log('service ready; no listener yet');
  } finally {
    store.close();
  }
};

if (process.argv.includes('--check')) {
  await check();
} else {
  await start();
}
