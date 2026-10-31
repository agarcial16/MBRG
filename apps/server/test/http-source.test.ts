import { describe, expect, it } from 'vitest';
import { sourceOf } from '../src/http/source';

// Spec 011 M4 T2 (plan section 8, P12): the source of a request is the TCP peer unless the operator says that N proxies
// sit in front of the server. With N hops the entry N places from the right of X-Forwarded-For is the client as the
// outermost trusted proxy saw it; everything to its left is written by the caller and ignored. Anything doubtful falls
// back to the peer, so a forged header can only ever move a caller to its own address, never to somebody else's.

const PEER = '192.0.2.7';

describe('source of a request: hops 0', () => {
  it('hops 0 ignores X-Forwarded-For entirely: a forged header changes nothing', () => {
    expect(sourceOf(PEER, [], 0)).toBe(PEER);
    expect(sourceOf(PEER, ['203.0.113.9'], 0)).toBe(PEER);
    expect(sourceOf(PEER, ['203.0.113.9, 198.51.100.4'], 0)).toBe(PEER);
    expect(sourceOf(PEER, ['198.51.100.4', '203.0.113.9'], 0)).toBe(PEER);
    expect(sourceOf(PEER, ['garbage'], 0)).toBe(PEER);
  });
});

describe('source of a request: trusted hops', () => {
  it('hops 1 takes the last entry', () => {
    expect(sourceOf(PEER, ['203.0.113.9'], 1)).toBe('203.0.113.9');
    expect(sourceOf(PEER, ['198.51.100.4, 203.0.113.9'], 1)).toBe('203.0.113.9');
    expect(sourceOf(PEER, ['6.6.6.6, 198.51.100.4, 203.0.113.9'], 1)).toBe('203.0.113.9');
  });

  it('hops 2 takes the second entry from the right, and hops 3 the third', () => {
    expect(sourceOf(PEER, ['198.51.100.4, 203.0.113.9'], 2)).toBe('198.51.100.4');
    expect(sourceOf(PEER, ['6.6.6.6, 198.51.100.4, 203.0.113.9'], 2)).toBe('198.51.100.4');
    expect(sourceOf(PEER, ['6.6.6.6, 198.51.100.4, 203.0.113.9'], 3)).toBe('6.6.6.6');
  });

  it('a forged leftmost entry never wins: the caller cannot choose the entry a trusted proxy appended', () => {
    expect(sourceOf(PEER, ['1.1.1.1, 2.2.2.2, 203.0.113.9'], 1)).toBe('203.0.113.9');
    expect(sourceOf(PEER, ['1.1.1.1, 198.51.100.4, 203.0.113.9'], 2)).toBe('198.51.100.4');
  });

  it('fewer entries than hops falls back to the peer', () => {
    expect(sourceOf(PEER, [], 1)).toBe(PEER);
    expect(sourceOf(PEER, ['203.0.113.9'], 2)).toBe(PEER);
    expect(sourceOf(PEER, ['198.51.100.4, 203.0.113.9'], 3)).toBe(PEER);
    expect(sourceOf(PEER, ['203.0.113.9'], 8)).toBe(PEER);
  });

  it('several header lines are joined in order, as if they were one line', () => {
    expect(sourceOf(PEER, ['6.6.6.6', '198.51.100.4', '203.0.113.9'], 1)).toBe('203.0.113.9');
    expect(sourceOf(PEER, ['6.6.6.6', '198.51.100.4', '203.0.113.9'], 3)).toBe('6.6.6.6');
    expect(sourceOf(PEER, ['6.6.6.6, 198.51.100.4', '203.0.113.9'], 2)).toBe('198.51.100.4');
    expect(sourceOf(PEER, ['6.6.6.6', '198.51.100.4, 203.0.113.9'], 3)).toBe('6.6.6.6');
  });

  it('spaces and tabs around an entry are not part of it', () => {
    expect(sourceOf(PEER, ['  198.51.100.4 ,\t203.0.113.9  '], 1)).toBe('203.0.113.9');
    expect(sourceOf(PEER, ['  198.51.100.4 ,\t203.0.113.9  '], 2)).toBe('198.51.100.4');
  });

  it('the chosen entry is an IP literal as written, an IPv6 one in lower case', () => {
    expect(sourceOf(PEER, ['2001:DB8::1'], 1)).toBe('2001:db8::1');
    expect(sourceOf(PEER, ['::1'], 1)).toBe('::1');
    expect(sourceOf(PEER, ['::ffff:192.0.2.128'], 1)).toBe('::ffff:192.0.2.128');
    expect(sourceOf(PEER, ['2001:db8:0:0:0:0:0:1'], 1)).toBe('2001:db8:0:0:0:0:0:1');
    expect(sourceOf(PEER, ['0.0.0.0'], 1)).toBe('0.0.0.0');
    expect(sourceOf(PEER, ['255.255.255.255'], 1)).toBe('255.255.255.255');
  });
});

describe('source of a request: doubtful headers fall back to the peer', () => {
  it('an entry that is not an IP literal makes the whole header untrusted', () => {
    for (const bad of ['garbage', '203.0.113.9:80', '[2001:db8::1]', '256.1.1.1', '1.2.3', '1.2.3.4.5', '01.2.3.4', '1.2.3.-4', '1.2.3.4/24', 'unknown', '_hidden', '1.2.3.4%eth0', ':::', '1::2::3', '12345::1', '1:2:3:4:5:6:7:8:9', 'g::1', '0x7f.0.0.1', '1e2.0.0.1']) {
      expect(sourceOf(PEER, [bad], 1), JSON.stringify(bad)).toBe(PEER);
      // Even when the bad entry is not the one a hop count would pick.
      expect(sourceOf(PEER, [`${bad}, 203.0.113.9`], 1), JSON.stringify(bad)).toBe(PEER);
      expect(sourceOf(PEER, [`203.0.113.9, ${bad}`], 1), JSON.stringify(bad)).toBe(PEER);
    }
  });

  it('an empty entry or an empty header falls back', () => {
    expect(sourceOf(PEER, [''], 1)).toBe(PEER);
    expect(sourceOf(PEER, [' '], 1)).toBe(PEER);
    expect(sourceOf(PEER, ['203.0.113.9,'], 1)).toBe(PEER);
    expect(sourceOf(PEER, [',203.0.113.9'], 1)).toBe(PEER);
    expect(sourceOf(PEER, ['198.51.100.4,,203.0.113.9'], 1)).toBe(PEER);
    expect(sourceOf(PEER, ['198.51.100.4', '', '203.0.113.9'], 1)).toBe(PEER);
  });

  it('an entry over 64 characters falls back (edge: 39 characters of IPv6 are fine, 65 are not)', () => {
    const long = `::${'0:'.repeat(31)}1`;
    expect(long.length).toBeGreaterThan(64);
    expect(sourceOf(PEER, [long], 1)).toBe(PEER);
    expect(sourceOf(PEER, ['1:2:3:4:5:6:7:8'], 1)).toBe('1:2:3:4:5:6:7:8');
    expect(sourceOf(PEER, ['0000:0000:0000:0000:0000:ffff:192.168.100.228'], 1)).toBe('0000:0000:0000:0000:0000:ffff:192.168.100.228');
    // 65 characters of padding around a good literal.
    expect(sourceOf(PEER, [`${'0'.repeat(60)}1.2.3.4`], 1)).toBe(PEER);
  });

  it('more than 16 entries falls back, 16 are read (edge)', () => {
    const entries = (n: number): string => Array.from({ length: n }, (_, i) => `10.0.0.${i + 1}`).join(', ');
    expect(sourceOf(PEER, [entries(16)], 1)).toBe('10.0.0.16');
    expect(sourceOf(PEER, [entries(16)], 8)).toBe('10.0.0.9');
    expect(sourceOf(PEER, [entries(17)], 1)).toBe(PEER);
    expect(sourceOf(PEER, [entries(40)], 1)).toBe(PEER);
    // The count is taken over every line together.
    expect(sourceOf(PEER, [entries(9), entries(8)], 1)).toBe(PEER);
    expect(sourceOf(PEER, [entries(8), entries(8)], 1)).toBe('10.0.0.8');
  });

  it('a header line of control characters, a NUL or a line break falls back', () => {
    for (const bad of ['203.0.113.9\u0000', '203.0.113.9\n198.51.100.4', '203.0.113.9\r', '\u0000', '203.0.113.9 ']) {
      expect(sourceOf(PEER, [bad], 1), JSON.stringify(bad)).toBe(PEER);
    }
  });
});

describe('source of a request: arguments', () => {
  it('the hop count is a whole number 0 to 8 (a programming error otherwise)', () => {
    for (const hops of [-1, 9, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => sourceOf(PEER, ['203.0.113.9'], hops), String(hops)).toThrow(RangeError);
    }
    expect(sourceOf(PEER, ['203.0.113.9'], 1)).toBe('203.0.113.9');
  });

  it('the peer is returned as given, even when it is not an IP literal (a destroyed socket has its own placeholder)', () => {
    expect(sourceOf('unknown-peer-3', [], 0)).toBe('unknown-peer-3');
    expect(sourceOf('unknown-peer-3', ['203.0.113.9'], 2)).toBe('unknown-peer-3');
  });
});
