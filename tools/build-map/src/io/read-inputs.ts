import { join } from 'node:path';
import type { InputName } from '../core/types';
import type { FsOps } from './fs-ops';

/** FR-111: where each input lives under the data directory (fixed local names, no network). */
export const INPUT_FILES: Record<InputName, string> = {
  provinces: 'natural-earth/provinces.json',
  countries: 'natural-earth/countries.json',
  otherLand: 'natural-earth/other-land.json',
  meta: 'natural-earth/source-meta.json',
  grouping: 'dev-map/grouping.json',
  seeds: 'dev-map/sea-seeds.json',
  params: 'dev-map/params.json',
};

/**
 * FR-111, FR-112: the text of every input file. A file that cannot be read (missing, unreadable,
 * not UTF-8) is left out, so `parseBuildInputs` reports it as an unreadable input.
 */
export function readInputTexts(dataDir: string, fs: FsOps): Partial<Record<InputName, string>> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const texts: Partial<Record<InputName, string>> = {};
  for (const name of Object.keys(INPUT_FILES) as InputName[]) {
    try {
      texts[name] = decoder.decode(fs.readFile(join(dataDir, INPUT_FILES[name])));
    } catch {
      // left out: reported as `invalid-input` by the parser
    }
  }
  return texts;
}
