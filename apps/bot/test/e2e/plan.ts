// The golden scripted match of the e2e harness (spec 023 FR-540): the round seeds the server is given, the four players, the
// choices they make and the channel texts the run must produce. The outcomes (victims, absorbers, forced rounds, points) are
// PINNED HERE, not recomputed: the dev map, `@mbrg/sim` or the seeds changing what round k plays breaks this file on purpose
// (a golden), and the fixture is re-pinned then. Points: a correct victim guess is worth the factions living at N, a correct
// absorber guess the absorption candidates (spec 008 scoring).
import { STRINGS, fill } from '../../src/core/strings';

/** The round seeds handed to the real server through its test seed source (round k uses SEEDS[k - 1]). */
export const SEEDS: readonly number[] = [11, 22, 33, 44];

/** The faction names of maps/dev/presentation.json, as the server serves them to the bot. */
export const FACTION_NAMES: Readonly<Record<number, string>> = { 1: 'Alemania', 2: 'España', 3: 'Francia', 4: 'Italia', 5: 'Portugal' };

export interface Player {
  readonly userId: string;
  readonly displayName: string;
}

/** The four named members who predict (spec 022: the display name travels with every prediction). */
export const PLAYERS: readonly Player[] = [
  { userId: '111111111111111111', displayName: 'Ana' },
  { userId: '222222222222222222', displayName: 'Bruno' },
  { userId: '333333333333333333', displayName: 'Carla' },
  { userId: '444444444444444444', displayName: 'Diego' },
];

export const playerBy = (userId: string): Player | undefined => PLAYERS.find((p) => p.userId === userId);
export const mentionOf = (userId: string): string => `<@${userId}>`;

export interface RoundPlan {
  readonly round: number;
  /** The faction eliminated (the seed's victim). */
  readonly victim: number;
  /** The faction that absorbs it. */
  readonly absorber: number;
  /** True when the victim has a single absorber candidate: no phase-2 prediction. */
  readonly forced: boolean;
  /** Factions alive once the round is applied. */
  readonly livingAfter: number;
  /** userId -> the faction picked as victim in phase 1 (absent: no prediction). */
  readonly pickVictim: Readonly<Record<string, number>>;
  /** userId -> the faction picked as absorber in phase 2 (empty for a forced round). */
  readonly pickAbsorber: Readonly<Record<string, number>>;
}

/** The four rounds of the dev map under SEEDS: r1 Francia->Alemania, r2 España->Portugal, r3 Portugal->Alemania, r4 (forced) Alemania->Italia. */
export const PLAN: readonly RoundPlan[] = [
  {
    round: 1, victim: 3, absorber: 1, forced: false, livingAfter: 4,
    pickVictim: { '111111111111111111': 3, '222222222222222222': 1, '333333333333333333': 2, '444444444444444444': 5 },
    pickAbsorber: { '111111111111111111': 1, '222222222222222222': 2, '444444444444444444': 4 },
  },
  {
    round: 2, victim: 2, absorber: 5, forced: false, livingAfter: 3,
    pickVictim: { '111111111111111111': 5, '222222222222222222': 2, '333333333333333333': 4, '444444444444444444': 1 },
    pickAbsorber: { '111111111111111111': 1, '333333333333333333': 5 },
  },
  {
    round: 3, victim: 5, absorber: 1, forced: false, livingAfter: 2,
    pickVictim: { '111111111111111111': 5, '222222222222222222': 1, '444444444444444444': 4 },
    pickAbsorber: { '111111111111111111': 1, '222222222222222222': 4 },
  },
  {
    round: 4, victim: 1, absorber: 4, forced: true, livingAfter: 1,
    pickVictim: { '111111111111111111': 4, '222222222222222222': 1, '333333333333333333': 4, '444444444444444444': 4 },
    pickAbsorber: {},
  },
];

/** The ids whose phase-1/phase-2 guesses are right, in the plan's player order (at most one per scored phase, so the winners sentence has no order ambiguity). */
export const correctVictimOf = (r: RoundPlan): string[] => PLAYERS.filter((p) => r.pickVictim[p.userId] === r.victim).map((p) => p.userId);
export const correctAbsorberOf = (r: RoundPlan): string[] => PLAYERS.filter((p) => r.pickAbsorber[p.userId] === r.absorber).map((p) => p.userId);

/**
 * How many scored predictions a player makes in a match's plan: one per victim pick and one per absorber pick (the plans hold no
 * winner picks). The independent count behind the ranking pins' `scored` and `played` (the leaderboards carry no such number).
 */
export const picksOf = (plan: readonly RoundPlan[], userId: string): number =>
  plan.reduce((n, r) => n + (r.pickVictim[userId] !== undefined ? 1 : 0) + (r.pickAbsorber[userId] !== undefined ? 1 : 0), 0);

export const factionName = (faction: number): string => FACTION_NAMES[faction] ?? `Facción ${faction}`;
const say = (key: keyof typeof STRINGS, values: Readonly<Record<string, string | number>> = {}): string => fill(STRINGS[key], values);

/** The sentence of a scored phase from the right guessers (the same rule as the bot: mentions, at most ten, then "y N más"). */
const winnersSentence = (phase: 1 | 2, ids: readonly string[]): string => {
  if (ids.length === 0) return phase === 1 ? STRINGS.winnersNoneVictim : STRINGS.winnersNoneAbsorber;
  const list = ids.slice(0, 10).map(mentionOf).join(', ');
  const mentions = ids.length > 10 ? fill(STRINGS.winnersMore, { list, n: ids.length - 10 }) : list;
  return say(phase === 1 ? 'winnersVictim' : 'winnersAbsorber', { mentions });
};

/** The final public leaderboard text, page 1 (spec 017): one page for four rows. The points come from the plan: a correct victim guess is worth the factions living at N, a correct absorber guess the absorption candidates. */
const boardText = (() => {
  const points: readonly number[] = [13, 6, 3, 0];
  return [
    STRINGS.boardTitle,
    ...PLAYERS.map((p, i) => say('boardRow', { rank: i + 1, who: mentionOf(p.userId), points: points[i]! })),
    say('boardPage', { page: 1, pages: 1 }),
  ].join('\n');
})();

/**
 * The channel texts of every announcement the follower posts, in order (the lobby message is a shell reply, not a follower
 * post). One entry per post: the exact sentence the channel must read.
 */
export const EXPECTED_POST_TEXTS: readonly string[] = [
  say('roundOpened', { round: 1 }),
  ...PLAN.flatMap((r, i) => {
    const reveal = r.forced
      ? say('victimForced', { round: r.round, victim: factionName(r.victim), absorber: factionName(r.absorber) })
      : say('victimRevealed', { round: r.round, victim: factionName(r.victim) });
    const winners1 = winnersSentence(1, correctVictimOf(r));
    const left = r.livingAfter === 1 ? STRINGS.factionsLeftOne : say('factionsLeftMany', { n: r.livingAfter });
    const applied = say('roundApplied', { round: r.round, victim: factionName(r.victim), absorber: factionName(r.absorber), left }).trim();
    const winners2 = r.forced ? [] : [winnersSentence(2, correctAbsorberOf(r))];
    const nextOpened = i < PLAN.length - 1 ? [say('roundOpened', { round: r.round + 1 })] : [];
    return [reveal, winners1, applied, ...winners2, ...nextOpened];
  }),
  say('matchFinished', { winner: factionName(PLAN[PLAN.length - 1]!.absorber) }),
  boardText,
];

// For this plan every scored phase has at most one right guesser, so no winners sentence ever runs into "y N más".

// --- The second match and the ranking of the server (spec 025 FR-572) ---------------------------------------------------------------
// The same seeds make the same four rounds again (r1 Francia->Alemania, r2 España->Portugal, r3 Portugal->Alemania, r4 forced), so only the
// picks change. Worth of a correct guess (spec 008): the victim of round N is worth the factions living at N (r1 5, r2 4, r3 3, r4 2), the
// absorber the absorption candidates (r1 3, r2 3, r3 2). The statistics below are worked out BY HAND from those picks, never read from a run.

const ANA = '111111111111111111';
const BRUNO = '222222222222222222';
const CARLA = '333333333333333333';
const DIEGO = '444444444444444444';

/**
 * The second scripted match: Bruno predicts everything right (22 points, the winner), Diego is right on the two first rounds (15), Carla
 * misses round 2 and skips round 4 (13), Ana misses everything (0 points: she still played). Scored predictions of this match: Ana 7, Bruno 7,
 * Carla 6, Diego 4.
 */
export const PLAN_B: readonly RoundPlan[] = [
  { ...PLAN[0]!, pickVictim: { [ANA]: 1, [BRUNO]: 3, [CARLA]: 3, [DIEGO]: 3 }, pickAbsorber: { [ANA]: 2, [BRUNO]: 1, [CARLA]: 1, [DIEGO]: 1 } },
  { ...PLAN[1]!, pickVictim: { [ANA]: 1, [BRUNO]: 2, [CARLA]: 4, [DIEGO]: 2 }, pickAbsorber: { [ANA]: 1, [BRUNO]: 5, [CARLA]: 1, [DIEGO]: 5 } },
  { ...PLAN[2]!, pickVictim: { [ANA]: 4, [BRUNO]: 5, [CARLA]: 5 }, pickAbsorber: { [ANA]: 4, [BRUNO]: 1, [CARLA]: 1 } },
  { ...PLAN[3]!, pickVictim: { [ANA]: 4, [BRUNO]: 1 }, pickAbsorber: {} },
];

/** The final board of the second match as the server ranks it: [user id, rank, points]. */
export const BOARD_B: readonly (readonly [string, number, number])[] = [[BRUNO, 1, 22], [DIEGO, 2, 15], [CARLA, 3, 13], [ANA, 4, 0]];

export interface Pin {
  readonly userId: string;
  readonly points: number;
  readonly correct: number;
  readonly scored: number;
  readonly played: number;
  readonly won: number;
}

/**
 * The statistics of the four players after the two matches (sums of the two plans): Ana 13 + 0 points, 4 + 0 right of 7 + 7, the match of round one
 * won; Bruno 6 + 22, 2 + 7 of 6 + 7, the second match won; Carla 3 + 13, 1 + 4 of 4 + 6 (exactly 10: qualified for accuracy), none won; Diego 0 + 15,
 * 0 + 4 of 5 + 4 (exactly 9: NOT qualified), none won. All of them played two matches.
 */
export const RANKING_PINS: readonly Pin[] = [
  { userId: ANA, points: 13, correct: 4, scored: 14, played: 2, won: 1 },
  { userId: BRUNO, points: 28, correct: 9, scored: 13, played: 2, won: 1 },
  { userId: CARLA, points: 16, correct: 5, scored: 10, played: 2, won: 0 },
  { userId: DIEGO, points: 15, correct: 4, scored: 9, played: 2, won: 0 },
];

/** After the first match alone (the second not settled yet): Ana's row, 4 right of 7 is 57 %. */
export const ANA_AFTER_FIRST = '1. <@111111111111111111> - 13 pts · aciertos 4/7 · victorias 1 · partidas 1 · precisión 57 %';

export type RankOrder = 'points' | 'correct' | 'wins' | 'accuracy';

/**
 * The ranking of each order: the players in order with their rank (none: the unranked tail of the accuracy order). Ties share the rank and
 * are ordered by total points: correct 4 and 4 (Diego 15 points before Ana 13), wins 1 and 1 (Bruno 28 before Ana 13) and 0 and 0 (Carla 16
 * before Diego 15). Accuracy: Bruno 9/13, Carla 5/10, Ana 4/14, and Diego (9 scored, fewer than 10) after them with no rank.
 */
export const RANKING_ORDER: Readonly<Record<RankOrder, readonly (readonly [string, number | undefined])[]>> = {
  points: [[BRUNO, 1], [CARLA, 2], [DIEGO, 3], [ANA, 4]],
  correct: [[BRUNO, 1], [CARLA, 2], [DIEGO, 3], [ANA, 3]],
  wins: [[BRUNO, 1], [ANA, 1], [CARLA, 3], [DIEGO, 3]],
  accuracy: [[BRUNO, 1], [CARLA, 2], [ANA, 3], [DIEGO, undefined]],
};

/** The whole percent of right guesses, rounded down, worked out here with integers (never rounded to the nearest). */
export const percentOf = (correct: number, scored: number): number => Math.floor((100 * correct) / scored);

/** The statistics of a row as the channel reads them, the ordering one first: written out with literal words, independent of the bot's templates. */
export function statsLine(order: RankOrder, pin: Pin): string {
  const parts: Record<RankOrder | 'played', string> = {
    points: `${pin.points} pts`,
    correct: `aciertos ${pin.correct}/${pin.scored}`,
    wins: `victorias ${pin.won}`,
    played: `partidas ${pin.played}`,
    accuracy: `precisión ${percentOf(pin.correct, pin.scored)} %`,
  };
  const rest = (['points', 'correct', 'wins', 'played', 'accuracy'] as const).filter((key) => key !== order);
  return [parts[order], ...rest.map((key) => parts[key])].join(' · ');
}

const pinOf = (userId: string): Pin => RANKING_PINS.find((p) => p.userId === userId)!;

/** The description of the ranking page of an order: one line per player, and the note before the unranked tail. */
export function rankingDescription(order: RankOrder): string[] {
  const lines: string[] = [];
  for (const [userId, rank] of RANKING_ORDER[order]) {
    if (rank === undefined && !lines.some((l) => l.startsWith('Menos de'))) lines.push('Menos de 10 predicciones: sin puesto en precisión');
    lines.push(`${rank === undefined ? '—' : `${rank}.`} <@${userId}> - ${statsLine(order, pinOf(userId))}`);
  }
  return lines;
}

/** The "Tu puesto" value of a player under an order; none when they have no rank (the accuracy tail). */
export function askerLine(order: RankOrder, userId: string): string | undefined {
  const rank = RANKING_ORDER[order].find(([id]) => id === userId)?.[1];
  return rank === undefined ? undefined : `Puesto ${rank} · ${statsLine(order, pinOf(userId))}`;
}

/** The final public leaderboard of the second match: rank, mention and points, the page of four rows. */
export const boardTextB: string = [
  'Clasificación',
  ...BOARD_B.map(([userId, rank, points]) => `${rank}. <@${userId}> - ${points} pts`),
  'Página 1/1',
].join('\n');
