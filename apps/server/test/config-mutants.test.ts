import { readFileSync } from 'node:fs';
import { PUBLIC_CONFIG_KEYS, encodePublicConfig, readPublicConfig } from '@mbrg/protocol';
import type { PublicConfig } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { publicConfigOf } from '../src/service/public-config';
import { readSettings } from '../src/service/settings';

// Spec 014 T5 (mutation table): the wrong outputs a mutated encoder or service could produce. Each differs from the golden
// bytes and is refused by the decoder or by the consistency check (the bytes must equal the encoding of the settings).

interface Example {
  readonly name: string;
  readonly config: PublicConfig;
  readonly text: string;
  readonly sha256: string;
}
const GOLDEN = JSON.parse(readFileSync(new URL('../../../packages/protocol/test/golden/config-014.json', import.meta.url), 'utf8')) as Example[];
const THREE = GOLDEN[1]!;

/** True when the text is not a faithful public config of `expected`: the decoder refuses it, or the bytes differ. */
function refused(text: string, expected: PublicConfig): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return true;
  }
  if (!readPublicConfig(parsed).ok) return true;
  return text !== encodePublicConfig(expected);
}

const without = (key: string): string => {
  const { [key]: _gone, ...rest } = JSON.parse(THREE.text) as Record<string, unknown>;
  return JSON.stringify(rest);
};
const withExtra = (key: string, value: unknown): string => JSON.stringify({ ...(JSON.parse(THREE.text) as object), [key]: value });

const MUTANTS: readonly [string, string][] = [
  ...PUBLIC_CONFIG_KEYS.map((key): [string, string] => [`field dropped: ${key}`, without(key)]),
  ['field added: lobbyExpiryHours', withExtra('lobbyExpiryHours', 24)],
  ['field added: a match count', withExtra('openLobbies', 3)],
  ['field added: a time stamp', withExtra('at', 1_700_000_000_000)],
  ['leaked setting: host', withExtra('host', '127.0.0.1')],
  ['leaked setting: allowed origins', withExtra('allowedOrigins', ['https://app.example'])],
  ['leaked setting: a rate limit', withExtra('anonymous', 120)],
  ['leaked setting: the operator credential', withExtra('operatorCredential', 'secret-credential')],
  ['enabled flipped', THREE.text.replace('"enabled":true', '"enabled":false')],
  ['map order reversed', THREE.text.replace('["iberia","europe-1444","world-2"]', '["world-2","europe-1444","iberia"]')],
  ['map list sorted', THREE.text.replace('["iberia","europe-1444","world-2"]', '["europe-1444","iberia","world-2"]')],
  ['whitespace added', JSON.stringify(JSON.parse(THREE.text), null, 1)],
  ['keys swapped', THREE.text.replace('"minInterval":45,"maxInterval":7200', '"maxInterval":7200,"minInterval":45')],
  ['an interval bound changed', THREE.text.replace('"minInterval":45', '"minInterval":46')],
];

describe('the mutation table of the public config output', () => {
  it('NFR-81 the golden examples pass the check, so a refusal below is caused by the mutant alone', () => {
    for (const example of GOLDEN) {
      expect(example.text, example.name).toBe(encodePublicConfig(example.config));
      expect(refused(example.text, example.config), example.name).toBe(false);
    }
  });

  it.each(MUTANTS)('NFR-81 mutant "%s" differs from the golden bytes and is refused', (_name, text) => {
    expect(text).not.toBe(THREE.text);
    expect(refused(text, THREE.config)).toBe(true);
  });

  it('NFR-81 mutants of the settings read: a flipped enabled, a dropped bound and a leaked field fail the same check', () => {
    const read = readSettings({
      MBRG_OPERATOR_CREDENTIAL: 'operator-credential-test-0123456789',
      MBRG_MAPS: '{"dev":"maps/dev","iberia":"maps/dev"}',
      MBRG_PUBLIC_MAPS: 'iberia,dev',
      MBRG_PUBLIC_MIN_INTERVAL: '45',
    });
    if (!read.ok) throw new Error('settings refused');
    const good = publicConfigOf(read.settings);
    const goodText = encodePublicConfig(good);
    expect(refused(goodText, good)).toBe(false);
    expect(refused(goodText.replace('"enabled":true', '"enabled":false'), good)).toBe(true);
    expect(refused(goodText.replace(',"minPhase2":5', ''), good)).toBe(true);
    expect(refused(goodText.replace('}', ',"lobbyExpiryHours":24}'), good)).toBe(true);
    expect(refused(encodePublicConfig({ ...good, maps: [...good.maps].reverse() }), good)).toBe(true);
    expect(refused(encodePublicConfig({ ...good, minInterval: good.minInterval + 1 }), good)).toBe(true);
  });
});
