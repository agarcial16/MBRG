import { describe, expect, it } from 'vitest';
import { ERROR_ORDER, timingRuleFailures, type PublicConfig } from '@mbrg/protocol';
import { STRINGS } from '../src/core/strings';
import {
  PACES,
  checkName,
  createBody,
  createFailure,
  createOptions,
  durationText,
  joinFailure,
  paceTiming,
  readCreation,
  startFailure,
} from '../src/core/play-forms';
import { MATCH_ID, publicAt, scripted } from './helpers/scripted-match';

const CONFIG: PublicConfig = { maps: ['europe', 'asia'], minInterval: 30, maxInterval: 3600, minPhase1: 10, minPhase2: 5, maxPlayers: 20, enabled: true };
const HOST = 'H0stH0stH0stH0stH0stH0stH0st_-ab';
const REQUEST = '0123456789abcdef0123456789abcdef';

/** The public bounds the server enforces (spec 011 FR-369), written here from the rule, not imported. */
function inside(c: PublicConfig, t: { i: number; l1: number; l2: number }): boolean {
  return timingRuleFailures(t).length === 0 && t.i >= c.minInterval && t.i <= c.maxInterval && t.l1 >= c.minPhase1 && t.l2 >= c.minPhase2;
}

describe('FR-393 the create form offers only what the public config allows', () => {
  it('FR-393 the three paces, in order, with their Spanish labels', () => {
    expect(PACES.map((p) => p.id)).toStrictEqual(['fast', 'normal', 'slow']);
    expect(PACES.map((p) => p.label)).toStrictEqual([STRINGS.createPaceFast, STRINGS.createPaceNormal, STRINGS.createPaceSlow]);
  });

  it('FR-393 each pace is a timing inside the public bounds, for the defaults and for tight and wide bounds', () => {
    const configs: PublicConfig[] = [
      CONFIG,
      { ...CONFIG, minInterval: 31, maxInterval: 33, minPhase1: 10, minPhase2: 20 },
      { ...CONFIG, minInterval: 400, maxInterval: 500, minPhase1: 200, minPhase2: 100 },
      { ...CONFIG, minInterval: 7, maxInterval: 7, minPhase1: 3, minPhase2: 3 },
      { ...CONFIG, minInterval: 90, maxInterval: 100000, minPhase1: 1, minPhase2: 1 },
    ];
    for (const c of configs) for (const pace of PACES) expect(inside(c, paceTiming(pace.id, c)), `${JSON.stringify(c)} ${pace.id}`).toBe(true);
  });

  it('FR-393 fast is the shortest allowed timing and the paces never get shorter from fast to slow', () => {
    expect(paceTiming('fast', CONFIG)).toStrictEqual({ i: 30, l1: 10, l2: 5 });
    const [fast, normal, slow] = PACES.map((p) => paceTiming(p.id, CONFIG));
    expect(normal!.i).toBeGreaterThanOrEqual(fast!.i);
    expect(slow!.i).toBeGreaterThanOrEqual(normal!.i);
    expect(slow!.i).toBeGreaterThan(fast!.i);
  });

  it('FR-450 the wait between the close of the predictions and the animation (L2) is 5 s, or the server minimum, in every pace', () => {
    for (const pace of PACES) expect(paceTiming(pace.id, CONFIG).l2, pace.id).toBe(5);
    expect(paceTiming('normal', { ...CONFIG, minPhase2: 8 }).l2).toBe(8);
  });

  it('FR-393 the options list the maps in the server order and say when public creation is off', () => {
    expect(createOptions(CONFIG)).toStrictEqual({ enabled: true, maps: ['europe', 'asia'] });
    expect(createOptions({ ...CONFIG, maps: [], enabled: false })).toStrictEqual({ enabled: false, maps: [] });
  });

  it('FR-393 the creation body holds the chosen map, the timing of the pace and the request id, and no operator credential', () => {
    const body = createBody({ mapId: 'asia', pace: 'normal', config: CONFIG, requestId: REQUEST });
    expect(body).toStrictEqual({ mapId: 'asia', timing: paceTiming('normal', CONFIG), requestId: REQUEST });
    expect(Object.keys(body).sort()).toStrictEqual(['mapId', 'requestId', 'timing']);
  });

  it('FR-393 a duration reads as seconds, minutes or hours', () => {
    expect(durationText(30)).toBe('30 s');
    expect(durationText(90)).toBe('1 min 30 s');
    expect(durationText(300)).toBe('5 min');
    expect(durationText(3600)).toBe('1 h');
    expect(durationText(5400)).toBe('1 h 30 min');
  });
});

describe('FR-394 the creation reply is read strictly', () => {
  async function reply(): Promise<Record<string, unknown>> {
    const s = await scripted();
    return { matchId: MATCH_ID, match: publicAt(s, 0, { stage: 'lobby', playerCount: 0 }), hostToken: HOST };
  }

  it('FR-394 a valid reply gives the match id, the match and the host token', async () => {
    const read = readCreation(await reply());
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value.matchId).toBe(MATCH_ID);
      expect(read.value.hostToken).toBe(HOST);
      expect(read.value.match.stage).toBe('lobby');
    }
  });

  it('FR-394 a reply with a missing, extra or malformed member is refused', async () => {
    const good = await reply();
    const without = (key: string): Record<string, unknown> => Object.fromEntries(Object.entries(good).filter(([k]) => k !== key));
    for (const bad of [without('hostToken'), without('match'), without('matchId'), { ...good, extra: 1 }, { ...good, hostToken: 'short' }, { ...good, matchId: 'x' }, null, 'text', [], { ...good, match: { stage: 'lobby' } }]) {
      expect(readCreation(bad).ok).toBe(false);
    }
  });

  it('FR-394 a reply whose match id differs from the inner match id is refused', async () => {
    const good = await reply();
    expect(readCreation({ ...good, matchId: 'ZyXwVuTs76543210' }).ok).toBe(false);
  });
});

describe('FR-395 FR-396 each refusal has one plain sentence', () => {
  it('FR-395 creation: one distinct sentence per named code, and a generic one for the rest', () => {
    const named = ['too-many-matches', 'rate-limited', 'invalid-timing', 'unknown-map', 'network', 'unavailable'];
    const sentences = named.map((code) => createFailure(code));
    expect(new Set(sentences).size).toBe(named.length);
    for (const s of sentences) expect(s.trim().length).toBeGreaterThan(0);
    expect(createFailure('too-many-matches')).toBe(STRINGS.createTooMany);
    expect(createFailure('something-new')).toBe(STRINGS.createFailed);
    expect(createFailure('unreadable')).toBe(STRINGS.createFailed);
  });

  it('FR-395 a rate-limited creation says how long to wait when the server said so', () => {
    expect(createFailure('rate-limited', 12)).toContain('12');
    expect(createFailure('rate-limited')).toBe(STRINGS.createRateLimited);
  });

  it('FR-396 join: one distinct sentence per code the spec names, and a generic one for the rest', () => {
    const named = ['name-taken', 'match-full', 'match-expired', 'match-finished', 'match-halted', 'rate-limited', 'unknown-match', 'network'];
    const sentences = named.map((code) => joinFailure(code));
    expect(new Set(sentences).size).toBe(named.length);
    expect(joinFailure('name-taken')).toBe(STRINGS.joinNameTaken);
    expect(joinFailure('match-full')).toBe(STRINGS.joinFull);
    expect(joinFailure('match-expired')).toBe(STRINGS.joinExpired);
    expect(joinFailure('match-finished')).toBe(STRINGS.joinFinished);
    expect(joinFailure('whatever')).toBe(STRINGS.joinFailed);
  });

  it('FR-398 start: the codes of a refused start have their own sentence', () => {
    expect(startFailure('forbidden')).toBe(STRINGS.lobbyStartForbidden);
    expect(startFailure('match-started')).toBe(STRINGS.lobbyStartStarted);
    expect(startFailure('match-expired')).toBe(STRINGS.joinExpired);
    expect(startFailure('network')).toBe(STRINGS.lobbyStartFailed);
  });

  it('FR-395 every code the sentences name is a real error kind of the protocol', () => {
    const real = new Set<string>(ERROR_ORDER);
    for (const code of ['too-many-matches', 'rate-limited', 'invalid-timing', 'unknown-map', 'unavailable', 'name-taken', 'match-full', 'match-expired', 'match-finished', 'match-halted', 'unknown-match', 'forbidden', 'match-started']) {
      expect(real.has(code), code).toBe(true);
    }
  });
});

describe('FR-396 the name rule of FR-377 is applied before sending', () => {
  it('FR-396 a valid name is returned trimmed and normalised', () => {
    expect(checkName('  Ana Maria ')).toStrictEqual({ ok: true, name: 'Ana Maria' });
    expect(checkName('José')).toStrictEqual({ ok: true, name: 'José' });
  });

  it('FR-396 an empty, long, double-spaced or symbol name is refused with the sentence that lists the allowed characters', () => {
    for (const text of ['', '   ', 'a'.repeat(25), 'a  b', 'Ana!', 'Ana\u{1F600}', 'a\tb']) {
      expect(checkName(text), text).toStrictEqual({ ok: false, sentence: STRINGS.joinNameRule });
    }
  });

  it('FR-396 a name of exactly 24 characters passes', () => {
    expect(checkName('a'.repeat(24)).ok).toBe(true);
  });
});
