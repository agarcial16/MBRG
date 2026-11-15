// Regenerates golden/tour-frame-pins-debug.json (spec 009 NFR-59, A13): REGRESSION PINS under the frozen debug-scene rules, written
// by the code under test. HAND-RUN and reviewed; the test never writes it. Reads the rounds from golden/tours.json. From the root:
//   npx tsx apps/web/test/golden/generate-tour-frame-pins-debug.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import type { MapData } from '@mbrg/shared';
import { decodeIdPng } from '../../src/core/png';
import { debugFramePinsText } from '../helpers/tour-pins';
import type { GoldenRound } from './tours-model';

const inflateStream = (zlib: Uint8Array): Promise<Uint8Array> => Promise.resolve(new Uint8Array(inflateSync(zlib)));
const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));
const map = JSON.parse(readFileSync(here('../../../../maps/dev/map.json'), 'utf8')) as MapData;
const rounds = (JSON.parse(readFileSync(here('./tours.json'), 'utf8')) as { rounds: GoldenRound[] }).rounds;
const png = await decodeIdPng(new Uint8Array(readFileSync(here('../../../../maps/dev/ids.png'))), inflateStream);
if (!png.ok) throw new Error('ids.png does not decode');
writeFileSync(here('./tour-frame-pins-debug.json'), debugFramePinsText(map, png.value, rounds));
console.log('written');
