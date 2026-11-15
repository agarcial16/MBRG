// The start screen of the single entry page (spec 010 FR-366): what a typed code or a pasted link becomes. Pure.
import { describe, expect, it } from 'vitest';
import { matchAddress } from '../src/core/start-screen';
import { chooseScene } from '../src/core/live-address';

const ID = 'AbCdEfGh01234567';

describe('FR-366 the start screen turns a code or a link into the address of a match', () => {
  it('FR-366 a bare match code becomes the match address', () => {
    expect(matchAddress(ID)).toStrictEqual({ ok: true, id: ID, search: `?match=${ID}` });
    expect(matchAddress(`  ${ID}\n`)).toStrictEqual({ ok: true, id: ID, search: `?match=${ID}` });
  });

  it('FR-366 a pasted link keeps only the match: its round and camera are not carried over, and the host does not matter', () => {
    expect(matchAddress(`https://example.org/play/?match=${ID}&round=2&x=3&y=4&zoom=1`)).toStrictEqual({ ok: true, id: ID, search: `?match=${ID}` });
    expect(matchAddress(`?match=${ID}`)).toStrictEqual({ ok: true, id: ID, search: `?match=${ID}` });
    expect(matchAddress(`match=${ID}&round=1`)).toStrictEqual({ ok: true, id: ID, search: `?match=${ID}` });
  });

  it('FR-366 anything that is not a match code is refused, before any request: empty, too short or long, other characters, two matches, a seed', () => {
    for (const text of ['', '   ', 'abc', `${ID}X`, `${ID.slice(0, 15)}`, 'AbCdEfGh0123456!', `?match=${ID}&match=ZyXwVuTs98765432`, `?seed=1&match=${ID}`, 'https://example.org/']) {
      expect(matchAddress(text), JSON.stringify(text)).toStrictEqual({ ok: false });
    }
  });

  it('FR-366 the address it builds is one the page accepts as a live match, in both builds', () => {
    const accepted = matchAddress(ID);
    if (!accepted.ok) throw new Error('accepted expected');
    for (const dev of [true, false]) expect(chooseScene(accepted.search, dev)).toStrictEqual({ kind: 'live', matchId: ID });
  });
});
