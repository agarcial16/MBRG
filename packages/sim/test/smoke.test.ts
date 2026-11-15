import { describe, expect, it } from 'vitest';
import { validateMap } from '@mbrg/shared';
import { totalRounds } from '@mbrg/sim';
import { pairMap } from './helpers/maps';

describe('workspace', () => {
  it('FR-55 sim resolves @mbrg/shared through the workspace', () => {
    expect(validateMap(pairMap()).ok).toBe(true);
    expect(totalRounds(pairMap())).toEqual({ ok: true, value: 1 });
  });
});
