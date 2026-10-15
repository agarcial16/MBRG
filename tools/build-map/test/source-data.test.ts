import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const data = join(here, '..', 'data');
const source = join(data, 'natural-earth');
const FILES = ['countries.json', 'other-land.json', 'provinces.json', 'source-meta.json'];
const MAX_SOURCE_BYTES = 10 * 1000 * 1000;

const text = (path: string): string => readFileSync(path, 'utf-8');

describe('NFR-17 and NFR-21 the committed Natural Earth source subset', () => {
  it('NFR-17 the committed source data holds exactly the four extraction outputs and the note, no Natural Earth download', () => {
    expect(readdirSync(source).sort()).toStrictEqual(['PROVENANCE.md', ...FILES].sort());
  });

  it('NFR-17 the committed source data (all outputs of the extraction step) is at most 10 MB', () => {
    const total = FILES.reduce((sum, name) => sum + statSync(join(source, name)).size, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(MAX_SOURCE_BYTES);
  });

  it('NFR-21 the source metadata record holds the version text and nothing else', () => {
    const meta = JSON.parse(text(join(source, 'source-meta.json'))) as Record<string, unknown>;
    expect(Object.keys(meta)).toStrictEqual(['version']);
    expect(meta['version']).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('NFR-21 the provenance note exists and contains the version string of the source metadata record', () => {
    const meta = JSON.parse(text(join(source, 'source-meta.json'))) as { version: string };
    expect(text(join(source, 'PROVENANCE.md'))).toContain(meta.version);
  });

  it('NFR-21 the provenance note states source, files, box, trimming, rounding, collapsing, command, Portugal and licence', () => {
    const note = text(join(source, 'PROVENANCE.md'));
    const box = JSON.parse(text(join(data, 'dev-map', 'extraction-box.json'))) as Record<string, number>;
    for (const needle of [
      'Natural Earth',
      'ne_10m_admin_1_states_provinces',
      'ne_10m_admin_0_countries',
      'SHA-256',
      'npm run extract -w @mbrg/build-map -- --ne',
      'trimming',
      'rounded',
      'collapsed',
      'Portugal',
      'districts',
      'public domain',
      'Made with Natural Earth',
      ...Object.keys(box).map((key) => `"${key}": ${box[key]}`),
    ]) {
      expect(note, needle).toContain(needle);
    }
  });

  it('NFR-21 the extraction box file holds west, south, east and north as finite numbers', () => {
    const box = JSON.parse(text(join(data, 'dev-map', 'extraction-box.json'))) as Record<string, unknown>;
    expect(Object.keys(box)).toStrictEqual(['west', 'south', 'east', 'north']);
    for (const value of Object.values(box)) expect(Number.isFinite(value)).toBe(true);
  });

  it('NFR-17 the committed source files are LF text with no NUL characters', () => {
    for (const name of FILES) {
      const content = text(join(source, name));
      expect(content.includes('\r'), name).toBe(false);
      expect(content.includes(String.fromCharCode(0)), name).toBe(false);
      expect(content.includes('\\u0000'), name).toBe(false);
    }
  });
});
