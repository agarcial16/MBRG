// Regenerates golden/wire-008.json (spec 011 FR-392: the 008 wire forms keep their bytes). A separate, reviewed, HAND-RUN step:
// the test never writes the golden.
//
// The pins must come from the 008 ENCODERS, not from the code under test. Procedure (done once, at spec 011 M5 T6):
//   1. extract the protocol sources of the commit before spec 011 into a scratch folder OUTSIDE the repository (no link, no
//      node_modules; the protocol imports nothing outside its own folder):
//        git archive 11c075e packages/protocol/src | tar -x -C <scratch>
//   2. run this script from the repository root with the path of the extracted index:
//        npx tsx apps/server/test/golden/generate-wire-008.ts <scratch>/packages/protocol/src/index.ts
// The cases (helpers/wire-008-cases.ts) are plain literals that use only members 008 knew. The script writes the SHA-256 of
// every encoded text, the commit it was taken from and the number of cases.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { allCases } from '../helpers/wire-008-cases';
import type { Encoders } from '../helpers/wire-008-cases';

const target = process.argv[2];
if (target === undefined) throw new Error('usage: generate-wire-008.ts <path of the 008 protocol index.ts>');
async function main(): Promise<void> {
const old = (await import(pathToFileURL(target!).href)) as Encoders & { CURSOR_LISTS: readonly string[] };
if (old.CURSOR_LISTS.length !== 6) throw new Error(`this is not the 008 protocol: ${old.CURSOR_LISTS.length} cursor lists`);
// The 008 encoders have no `players` or `phase-winners` list, no name and no lobby stage: the cases never reach them.
const cases = allCases(old);

const pins: Record<string, string> = {};
for (const [name, text] of Object.entries(cases)) pins[name] = createHash('sha256').update(text).digest('hex');
const out = {
  note: 'SHA-256 of the 008 encoder outputs for a fixed 008 match (helpers/wire-008-cases.ts), taken with the protocol package of commit 11c075e (the last commit before spec 011). Written by generate-wire-008.ts.',
  source: '11c075e',
  count: Object.keys(pins).length,
  pins,
};
writeFileSync(fileURLToPath(new URL('./wire-008.json', import.meta.url)), `${JSON.stringify(out, null, 1)}\n`);
console.log(`written ${out.count} pins`);
}
void main();
