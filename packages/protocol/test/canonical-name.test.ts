import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalBody } from '../src/index';

const path = '/matches/abc/predictions';
const body = { kind: 'victim', round: 1, faction: 5, playerId: 'a' };
const sha = (text: string): string => createHash('sha256').update(text, 'ascii').digest('hex');

describe('submission content with the optional name', () => {
  it('a body without name keeps the text and digest of the code before the member existed', () => {
    const text = canonicalBody('POST', path, { ...body, requestId: 'r1' });
    expect(text).toBe('"POST" "/matches/abc/predictions" {"faction":5,"kind":"victim","playerId":"a","round":1}');
    expect(sha(text)).toBe('3d1480982e0d1d46d65ce05043bffe5f3edd79094799dba028bf577bc3af890e');
  });

  it('a body with name differs, the member is in sorted position and requestId stays out', () => {
    const plain = canonicalBody('POST', path, body);
    const named = canonicalBody('POST', path, { ...body, requestId: 'r1', name: 'Ana' });
    expect(named).toBe('"POST" "/matches/abc/predictions" {"faction":5,"kind":"victim","name":"Ana","playerId":"a","round":1}');
    expect(sha(named)).not.toBe(sha(plain));
  });

  it('another name gives another digest', () => {
    const a = sha(canonicalBody('POST', path, { ...body, requestId: 'r1', name: 'Ana' }));
    const b = sha(canonicalBody('POST', path, { ...body, requestId: 'r1', name: 'Bea' }));
    expect(a).not.toBe(b);
  });
});
