import { describe, expect, it } from 'vitest';
import { isValidId } from '../src/ids';
import type { ValidationError } from '../src/errors';
import { VALIDATION_KIND_ORDER } from '../src/errors';

describe('ids', () => {
  it('FR-3 accepts the bounds 1 and 16,777,215', () => {
    expect(isValidId(1)).toBe(true);
    expect(isValidId(16_777_215)).toBe(true);
    expect(isValidId(42)).toBe(true);
  });

  it.each([
    ['0', 0],
    ['-0', -0],
    ['-1', -1],
    ['16,777,216', 16_777_216],
    ['1.5', 1.5],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['"1"', '1'],
    ['""', ''],
    ['null', null],
    ['undefined', undefined],
    ['true', true],
    ['false', false],
    ['[]', []],
    ['[1]', [1]],
    ['{}', {}],
  ])('FR-3 rejects %s', (_label, value) => {
    expect(isValidId(value)).toBe(false);
  });

  it('FR-8 territory and faction ids share one rule, so equal values are fine', () => {
    const territory = { id: 3, owner: 3, neighbors: [] as number[] };
    expect(isValidId(territory.id)).toBe(true);
    expect(isValidId(territory.owner)).toBe(true);
  });
});

describe('errors', () => {
  it('FR-10 kind order matches the spec table exactly', () => {
    const expected: ValidationError['kind'][] = [
      'invalid-map',
      'invalid-territories',
      'invalid-territory',
      'invalid-territory-id',
      'invalid-neighbors',
      'duplicate-territory-id',
      'missing-owner',
      'invalid-owner',
      'unknown-field',
      'unknown-neighbor',
      'self-neighbor',
      'duplicate-neighbor',
      'asymmetric-adjacency',
      'multiple-initial-territories',
      'too-few-factions',
      'disconnected-map',
    ];
    expect([...VALIDATION_KIND_ORDER]).toStrictEqual(expected);
  });
});
