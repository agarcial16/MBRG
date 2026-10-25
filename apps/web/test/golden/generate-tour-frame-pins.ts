// Regenerates golden/tour-frame-pins.json (spec 009 NFR-59): REGRESSION PINS written by the code under test (the
// frame digests of apps/web/src), not independent values. HAND-RUN and reviewed; the test never writes it.
// It reads the rounds from golden/tours.json (so generate that first). Run from the repository root:
//   npx tsx apps/web/test/golden/generate-tour-frame-pins.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import type { MapData } from '@mbrg/shared';
import { decodeIdPng } from '../../src/core/png';
import { framePinsText } from '../helpers/tour-pins';
import type { GoldenRound } from './tours-model';

// `ui/load` imports assets through Vite and cannot run here: the zlib stream is inflated with node:zlib.
const inflateStream = (zlib: Uint8Array): Promise<Uint8Array> => Promise.resolve(new Uint8Array(inflateSync(zlib)));
const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));
const map = JSON.parse(readFileSync(here('../../../../maps/dev/map.json'), 'utf8')) as MapData;
const rounds = (JSON.parse(readFileSync(here('./tours.json'), 'utf8')) as { rounds: GoldenRound[] }).rounds;
const png = await decodeIdPng(new Uint8Array(readFileSync(here('../../../../maps/dev/ids.png'))), inflateStream);
if (!png.ok) throw new Error('ids.png does not decode');
writeFileSync(here('./tour-frame-pins.json'), framePinsText(map, png.value, rounds));
console.log('written');
