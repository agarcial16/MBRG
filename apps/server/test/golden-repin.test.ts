import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { absorptionCandidatesOf, getState, playRoundWithSeed } from '@mbrg/sim';
import { describe, expect, it } from 'vitest';
import { forcedAnchors, toMs } from '../src/core/time';
import { devMap } from './helpers/digests';

// The re-pin of the 008 goldens after the forced absorber, checked by figures that are NOT read from the regenerated JSON:
// literal forced rounds and candidate counts (also re-derived with the sim), shortened anchors computed here by hand,
// absorber point totals of the scripted matches, and SHA-256 pins of the rows of core-timelines.json that must equal the
// pre-change file (the pins were taken from the `rewrite` version of the file before the re-pin).

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`./golden/${name}`, import.meta.url), 'utf8')) as T;
const sha = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex');

// d (absorption candidates of the victim, per round) of the three dev secrets, and the rounds whose absorber is forced (d = 1).
const D: Record<string, number[]> = {
  'ascending-00-1f': [3, 3, 2, 1],
  'ascending-20-3f': [3, 2, 2, 1],
  'all-a5': [2, 2, 1, 1],
};
const FORCED: Record<string, number[]> = { 'ascending-00-1f': [4], 'ascending-20-3f': [4], 'all-a5': [3, 4] };

interface Secrets {
  matches: Record<string, { rounds: { round: number; seed: number; victim: number }[] }>;
}
interface Action {
  act: string;
  rows: [number, string, number, string][];
  anchors: [number, number, number] | null;
  events: string[];
  stage: string;
  appliedRounds: number;
  victim: number | null;
  recordDigest: string | null;
}
interface Timelines {
  scenarios: Record<string, { timing: { i: number; l1: number; l2: number } | 'manual'; secret: string; creation: unknown; actions: Action[] }>;
}
interface Results {
  secrets: Record<string, { players: Record<string, { total: number; items: { kind: string; points: number }[] }> }>;
}

describe('re-pin of the 008 goldens by independent figures (NFR-48)', () => {
  it('NFR-48 the forced rounds and the candidate counts of the three dev secrets are the literals, re-derived with the sim', () => {
    const secrets = read<Secrets>('dev-secrets.json');
    const map = devMap();
    for (const [name, m] of Object.entries(secrets.matches)) {
      let state = getState(map, 0, 0);
      if (!state.ok) throw new Error('state');
      let s = state.value;
      const d: number[] = [];
      for (const r of m.rounds) {
        const c = absorptionCandidatesOf(map, s, r.victim);
        if (!c.ok) throw new Error('candidates');
        d.push(c.value.length);
        const played = playRoundWithSeed(map, s, r.seed);
        if (!played.ok) throw new Error('round');
        s = played.value.state;
      }
      expect(d, name).toStrictEqual(D[name]);
      expect(d.flatMap((x, i) => (x === 1 ? [i + 1] : [])), name).toStrictEqual(FORCED[name]);
    }
    expect(Object.keys(secrets.matches)).toStrictEqual(['ascending-00-1f', 'ascending-20-3f', 'all-a5']);
  });

  it('NFR-48 shortened phase 2 for I = 47, L1 = 13, L2 = 7, F = 5: C2 = t + 5, A = C2 + 7 (clock, late and manual closes), F above L1 changes nothing', () => {
    const timing = { i: 47, l1: 13, l2: 7 };
    const current = { t0: 0, c1: 27_000, c2: 40_000, a: 47_000 };
    // Hand-derived: on time, the 008 anchors are 27 s, 40 s, 47 s; the close at 27 s saves 13 - 5 = 8 s.
    expect(forcedAnchors(current, timing, 5, 27_000, 'clock')).toStrictEqual({ t0: 0, c1: 27_000, c2: 32_000, a: 39_000 });
    // A late close at 50 s: the 008 anchors are C2 = 63 s, A = 70 s; shortened C2 = 55 s, A = 62 s.
    expect(forcedAnchors(current, timing, 5, 50_000, 'late')).toStrictEqual({ t0: 0, c1: 27_000, c2: 55_000, a: 62_000 });
    expect(forcedAnchors(current, timing, 5, 50_000, 'manual')).toStrictEqual({ t0: 0, c1: 27_000, c2: 55_000, a: 62_000 });
    // F = 20 is above L1 = 13: min(L1, F) = L1, nothing is shortened.
    expect(forcedAnchors(current, timing, 20, 27_000, 'clock')).toStrictEqual(current);
    expect(forcedAnchors(null, timing, 5, 27_000, 'clock')).toBeNull();
    expect(forcedAnchors(current, 'manual', 5, 27_000, 'clock')).toBeNull();
  });

  it('NFR-48 every phase-1 close of a forced round in core-timelines.json holds C2 = t + min(L1, 5) s and A = C2 + L2 s (computed here)', () => {
    const g = read<Timelines>('core-timelines.json');
    const forcedBy: Record<string, number[]> = { 'ascending-00-1f': [4], 'all-a5': [3, 4] };
    let checked = 0;
    for (const [name, s] of Object.entries(g.scenarios)) {
      if (s.timing === 'manual') continue;
      const timing = s.timing;
      s.actions.forEach((a, n) => {
        for (const [round, kind, instant] of a.rows) {
          if (kind !== 'phase-1-close' || !forcedBy[s.secret]!.includes(round)) continue;
          const c2 = instant + toMs(Math.min(timing.l1, 5));
          expect(a.anchors, `${name} action ${n}`).toStrictEqual([a.anchors![0], c2, c2 + toMs(timing.l2)]);
          checked += 1;
        }
      });
    }
    // on-time 1, l2-zero 1, mid-round-advances 1, downtime-forward-jump 1, backward-jump 1 (all-a5 scenarios, if any, add two each).
    expect(checked).toBeGreaterThanOrEqual(5);
  });

  it('NFR-48 on-time scenario: the last round closes phase 1 at +440 s, phase 2 at +445 s and applies at +455 s (hand-derived, 30 s L1 shortened to 5 s)', () => {
    const g = read<Timelines>('core-timelines.json');
    const t0 = 1_700_000_000_000;
    const acts = g.scenarios['on-time']!.actions;
    expect(acts[19]!.rows).toStrictEqual([[4, 'phase-1-close', t0 + 440_000, 'clock']]);
    expect(acts[19]!.anchors).toStrictEqual([t0 + 440_000, t0 + 445_000, t0 + 455_000]);
    expect(acts[21]!.rows).toStrictEqual([[4, 'phase-2-close', t0 + 445_000, 'clock']]);
    expect(acts[23]!.rows).toStrictEqual([[4, 'application', t0 + 455_000, 'clock']]);
  });

  it('NFR-48 absorber point totals of the scripted matches: d points per right absorber, no row for a forced round', () => {
    const r = read<Results>('dev-results.json');
    const absorberSums = (secret: string): Record<string, number> =>
      Object.fromEntries(
        Object.entries(r.secrets[secret]!.players)
          .map(([id, p]) => [id, p.items.filter((i) => i.kind === 'absorber').reduce((n, i) => n + i.points, 0)] as const)
          .filter(([, n]) => n > 0),
      );
    // all-a5 (d = 2, 2, 1, 1): rounds 3 and 4 are forced and pay nothing; web:p1 scored 2 + 2, discord:p1 2 + 2, web:p5 2.
    expect(absorberSums('all-a5')).toStrictEqual({ 'discord:p1': 4, 'web:p1': 4, 'web:p5': 2 });
    // ascending-00-1f (d = 3, 3, 2, 1): round 4 is forced; web:p1 3 + 3 + 2, discord:p1 3 + 3, web:p5 3.
    expect(absorberSums('ascending-00-1f')).toStrictEqual({ 'discord:p1': 6, 'web:p1': 8, 'web:p5': 3 });
    // ascending-20-3f (d = 3, 2, 2, 1): web:p1 3 + 2 + 2, discord:p1 3 + 2, web:p5 2.
    expect(absorberSums('ascending-20-3f')).toStrictEqual({ 'discord:p1': 5, 'web:p1': 7, 'web:p5': 2 });
    // Totals of web:p5 (the player who predicted the forced last absorber before): victim 4 + absorber, 8 / 9 / 8 points.
    expect(['all-a5', 'ascending-00-1f', 'ascending-20-3f'].map((s) => r.secrets[s]!.players['web:p5']!.total)).toStrictEqual([8, 9, 8]);
  });

  it('NFR-48 the rows of core-timelines.json that cannot depend on the forced absorber equal the pre-change file (SHA-256 pins from the rewrite version)', () => {
    const g = read<Timelines>('core-timelines.json');
    // [scenario, number of leading actions before the first forced close, SHA of creation + those actions,
    //  SHA of the instant-free projection of all actions (rows without instants, event types, stage, rounds, victim, record digest)]
    const pins: [string, number, string, string][] = [
      ['on-time', 19, '13cf4f4f3d1ac26196e3d3448731858212572ea93ec7870117cf661c6748291d', 'def8af6e9c19f4ec599e5ac798f6169bd53e921bfe80074b18e367b8cb0c93cb'],
      ['l2-zero', 9, '2c85d5ad9b962b171345c973b7448db63eb86f37749e83bc1f08a68e2ec02fd3', 'cc14fc56f47a525f3f93f99830cdc8377bd36eb0c86ba2033dd13170871a5965'],
      ['manual', 9, '433103736bc619dfc2d3aa09b814830d7625c46670d65f3c47890ba535ea4f3f', 'b1dc26293459f2b2a394518e89a76da83822a798133a9c99deec409729991b5a'],
      ['mid-round-advances', 7, 'b52ac8503638a09070df5a9e986ccc2d8fbfdb28c44e1f740c6212a0ad21ab75', '2bb3933a0360701f4f1e7c528d6d7c24530240a826ee5748b2095b919ec2137e'],
      ['downtime-forward-jump', 12, '359359ae66b0f24f94cb6836c3fa274a5f650febd4b3653e6051766dbbfe562c', '06da5e80ce567bc07613c3fa0a358cc3e9ec378e6dad5c8accc6a8cf46b56bfb'],
      ['backward-jump', 9, '4eb64eff9ec283430fcb9d193979879de15b1d843c43fe106cc90c3ee5733029', '5ebd7ec666d33c69c4dc035619b0fca740e42a474dbf8fc44427ac91d6c9de2f'],
    ];
    expect(Object.keys(g.scenarios)).toStrictEqual(pins.map((p) => p[0]));
    for (const [name, lead, prefix, projection] of pins) {
      const s = g.scenarios[name]!;
      expect(sha({ creation: s.creation, actions: s.actions.slice(0, lead) }), `${name} prefix`).toBe(prefix);
      const proj = s.actions.map((a) => ({
        act: a.act,
        rows: a.rows.map((x) => [x[0], x[1], x[3]]),
        events: a.events,
        stage: a.stage,
        appliedRounds: a.appliedRounds,
        victim: a.victim,
        recordDigest: a.recordDigest,
      }));
      expect(sha(proj), `${name} projection`).toBe(projection);
    }
  });
});
