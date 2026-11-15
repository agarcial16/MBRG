import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as protocol from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { OLD_ERROR_KINDS, allCases, errorCases, eventCases, replyCases, viewCases } from './helpers/wire-008-cases';

// The 008 wire forms keep their bytes (spec 011 FR-392). The golden holds the SHA-256 of the text each 008 encoder gave for a
// fixed 008 match (public views in every stage and timing, every event type, the three results shapes, the other replies, the
// cursors and the error replies of the 22 kinds of 008), taken by golden/generate-wire-008.ts with the protocol package of the
// commit before spec 011 (11c075e, extracted into a scratch folder). The current encoders must give the same text for the same
// input. The forms the spec names as changed (the forced mark of a victim, the lobby stages, the player count and the optional
// name) are outside these inputs; they are pinned by their own tests.

interface Wire008 {
  readonly source: string;
  readonly count: number;
  readonly pins: Readonly<Record<string, string>>;
}
const GOLDEN = JSON.parse(readFileSync(new URL('./golden/wire-008.json', import.meta.url), 'utf8')) as Wire008;
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const now = allCases(protocol);

describe('the 008 wire forms', () => {
  it('FR-392 the golden was taken from the commit before spec 011 and holds one pin per case', () => {
    expect(GOLDEN.source).toBe('11c075e');
    expect(Object.keys(GOLDEN.pins)).toStrictEqual(Object.keys(now));
    expect(GOLDEN.count).toBe(Object.keys(now).length);
    // Literal counts: 11 views, 14 events, 25 other replies and cursors, 26 error replies (22 kinds, a second step-mismatch, 3 with items).
    expect(Object.keys(viewCases(protocol))).toHaveLength(11);
    expect(Object.keys(eventCases(protocol))).toHaveLength(14);
    expect(Object.keys(replyCases(protocol))).toHaveLength(25);
    expect(Object.keys(errorCases(protocol))).toHaveLength(26);
    expect(GOLDEN.count).toBe(76);
    for (const pin of Object.values(GOLDEN.pins)) expect(pin).toMatch(/^[0-9a-f]{64}$/);
  });

  it('FR-392 the public views of every stage and timing, the 14 event forms, the results shapes and the other replies encode to the pinned bytes', () => {
    const different = Object.entries(now).filter(([name, text]) => sha(text) !== GOLDEN.pins[name]).map(([name]) => name);
    expect(different).toStrictEqual([]);
  });

  it('FR-392 the error replies of the 22 kinds of 008 encode to the pinned bytes, in the order of 008', () => {
    expect(protocol.ERROR_ORDER.filter((kind) => (OLD_ERROR_KINDS as readonly string[]).includes(kind))).toStrictEqual([...OLD_ERROR_KINDS]);
    expect(OLD_ERROR_KINDS).toHaveLength(22);
    for (const kind of OLD_ERROR_KINDS) {
      const name = kind === 'step-mismatch' ? 'error step-mismatch phase-2' : `error ${kind}`;
      expect(now[name], kind).toBeDefined();
      expect(GOLDEN.pins[name], kind).toMatch(/^[0-9a-f]{64}$/);
      expect(sha(now[name]!), kind).toBe(GOLDEN.pins[name]);
    }
  });

  it('FR-392 a changed byte in any case is seen: the pin of a view differs from the pin of the same view with a different last sequence number', () => {
    const view = viewCases(protocol)['view phase-1 manual']!;
    expect(sha(view)).toBe(GOLDEN.pins['view phase-1 manual']);
    expect(sha(view.replace('"lastSeq":1', '"lastSeq":2'))).not.toBe(GOLDEN.pins['view phase-1 manual']);
    expect(sha(view.replace('}', ',"extra":1}'))).not.toBe(GOLDEN.pins['view phase-1 manual']);
  });

  it('FR-392 the forms the spec changes are the only additions: a victim with one candidate gains only "forced":true, a lobby view only its count, a result only its name', () => {
    const base = protocol.encodePublicMatch;
    const reveal = {
      matchId: 'fixed-008-match',
      mapId: 'dev',
      mapDigest: 'a'.repeat(64),
      totalRounds: 4,
      timing: 'manual',
      commitment: 'b'.repeat(64),
      stage: 'phase-2',
      appliedRounds: 0,
      state: { mode: 'classic', round: 0, owners: [[1, 1], [2, 2]] },
      stateDigest: 'c'.repeat(64),
      lastSeq: 5,
      reportedTime: 1,
      victim: { round: 1, victim: 2, candidates: [1], living: [1, 2], revealedAt: 1, c2: null, a: null, seq: 4 },
    } as never;
    const plain = base(reveal);
    const forced = base({ ...(reveal as object), victim: { ...(reveal as { victim: object }).victim, forced: true } } as never);
    expect(forced).toBe(plain.replace('"a":null,', '"a":null,"forced":true,'));
    const page = { round: 1, phase: 1 as const, victim: 2, items: [{ playerId: 'player:abc', choice: 2, correct: true, points: 5 }] };
    const named = protocol.encodePhaseResults({ ...page, items: [{ ...page.items[0]!, name: 'Ana' }] });
    expect(named).toBe(protocol.encodePhaseResults(page).replace('"points":5}', '"points":5,"name":"Ana"}'));
  });
});
