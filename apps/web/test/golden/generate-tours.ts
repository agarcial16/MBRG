// Regenerates golden/tours.json (spec 009 NFR-59). A separate, reviewed, HAND-RUN step: the test never writes the
// golden. It imports nothing of apps/web/src (see tours-model.ts). Run from the repository root:
//   npx tsx apps/web/test/golden/generate-tours.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { toursGoldenText } from './tours-model';

const map: unknown = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../maps/dev/map.json', import.meta.url)), 'utf8'));
writeFileSync(fileURLToPath(new URL('./tours.json', import.meta.url)), toursGoldenText(map));
console.log('written');
