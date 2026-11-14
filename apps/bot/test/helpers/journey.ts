// A scripted two-round match for the fake server: the events the real server emits, in the order of its steps (008 plan 20.4),
// with the public data patched alongside. Round 1 has a free absorber, round 2 a forced one and ends the match.
import { STRINGS, fill } from '../../src/core/strings';
import { MATCH_SECRET, SCHEDULE } from './fake-server';
import type { Fake, ResultRow } from './fake-server';

const row = (id: string, correct: boolean): ResultRow => ({ playerId: `discord:${id}`, choice: 1, correct, points: correct ? 2 : 0 });
export const WRONG_GUESSER = '333333333333333333';
const thirteen = Array.from({ length: 13 }, (_, i) => row(String(5000 + i), true));

const victimOf = (fake: Fake, round: number, victim: number, candidates: number[], living: number[], forced: boolean) => ({
  round, victim, candidates, living, revealedAt: 31_000, c2: SCHEDULE.c2, a: SCHEDULE.a, ...(forced ? { forced: true as const } : {}), seq: fake.match.lastSeq + 2,
});

/** The first reveal: phase 1 of round 1 closes, the victim is Alemania (1), its absorbers are 2 and 3. */
export function revealRound1(fake: Fake): void {
  fake.results.set('1/1', [row('111', true), row('222', true), row(WRONG_GUESSER, false)]);
  const victim = victimOf(fake, 1, 1, [2, 3], [1, 2, 3], false);
  fake.emit({ type: 'phase-closed', round: 1, phase: 1, at: 31_000 });
  fake.emit({ type: 'victim-revealed', round: 1, victim: 1, candidates: [2, 3], living: [1, 2, 3], revealedAt: 31_000, c2: SCHEDULE.c2, a: SCHEDULE.a, reportedTime: 31_000 }, { stage: 'phase-2', victim });
  fake.emit({ type: 'results', round: 1, phase: 1 });
  fake.emit({ type: 'schedule', stage: 'phase-2', schedule: SCHEDULE, reportedTime: 31_000 });
}

export function applyRound1(fake: Fake): void {
  fake.results.set('1/2', [row('111', true), row(WRONG_GUESSER, false)]);
  fake.emit({ type: 'phase-closed', round: 1, phase: 2, at: 60_000 }, { stage: 'locked' });
  fake.emit(
    { type: 'round-applied', round: 1, record: { round: 1, eliminated: 1, absorber: 2, transferred: [1] }, stateDigest: 'd'.repeat(64), appliedAt: 65_000 },
    { stage: 'phase-1', appliedRounds: 1, state: { mode: 'classic', round: 1, owners: [[1, 2], [2, 2], [3, 3]] }, victim: undefined },
  );
  fake.emit({ type: 'results', round: 1, phase: 2 });
  fake.emit({ type: 'schedule', stage: 'phase-1', schedule: SCHEDULE, reportedTime: 65_000 });
}

export function revealRound2Forced(fake: Fake): void {
  fake.results.set('2/1', thirteen);
  const victim = victimOf(fake, 2, 2, [3], [2, 3], true);
  fake.emit({ type: 'phase-closed', round: 2, phase: 1, at: 91_000 });
  fake.emit({ type: 'victim-revealed', round: 2, victim: 2, candidates: [3], living: [2, 3], revealedAt: 91_000, c2: SCHEDULE.c2, a: SCHEDULE.a, forced: true, reportedTime: 91_000 }, { stage: 'phase-2', victim });
  fake.emit({ type: 'results', round: 2, phase: 1 });
  fake.emit({ type: 'schedule', stage: 'phase-2', schedule: SCHEDULE, reportedTime: 91_000 });
}

export function finishRound2(fake: Fake): void {
  fake.emit({ type: 'phase-closed', round: 2, phase: 2, at: 100_000 }, { stage: 'locked' });
  fake.emit(
    { type: 'round-applied', round: 2, record: { round: 2, eliminated: 2, absorber: 3, transferred: [1, 2] }, stateDigest: 'e'.repeat(64), appliedAt: 105_000 },
    { stage: 'finished', appliedRounds: 2, state: { mode: 'classic', round: 2, owners: [[1, 3], [2, 3], [3, 3]] }, victim: undefined, schedule: undefined, winner: 3, matchSecret: MATCH_SECRET },
  );
  // The server emits the results of a forced phase 2 all the same; the bot must not ask for them.
  fake.emit({ type: 'results', round: 2, phase: 2 });
  fake.emit({ type: 'match-finished', winner: 3, matchSecret: MATCH_SECRET, rule: 'rule', reportedTime: 105_000 });
}

const say = (key: keyof typeof STRINGS, values: Record<string, string | number>): string => fill(STRINGS[key], values);
const more = '<@5000>, <@5001>, <@5002>, <@5003>, <@5004>, <@5005>, <@5006>, <@5007>, <@5008>, <@5009>';

/** What the channel reads, one message per entry, after each stage of the journey. */
export const TEXTS = {
  opened1: say('roundOpened', { round: 1 }),
  reveal1: say('victimRevealed', { round: 1, victim: 'Alemania' }),
  winners1: say('winnersVictim', { mentions: '<@111>, <@222>' }),
  applied1: say('roundApplied', { round: 1, victim: 'Alemania', absorber: 'España', left: say('factionsLeftMany', { n: 2 }) }),
  winners1b: say('winnersAbsorber', { mentions: '<@111>' }),
  opened2: say('roundOpened', { round: 2 }),
  forced2: say('victimForced', { round: 2, victim: 'España', absorber: 'Francia' }),
  winners2: say('winnersVictim', { mentions: say('winnersMore', { list: more, n: 3 }) }),
  applied2: say('roundApplied', { round: 2, victim: 'España', absorber: 'Francia', left: STRINGS.factionsLeftOne }),
  finished: say('matchFinished', { winner: 'Francia' }),
} as const;

export const FULL_JOURNEY: readonly string[] = [
  TEXTS.opened1, TEXTS.reveal1, TEXTS.winners1, TEXTS.applied1, TEXTS.winners1b, TEXTS.opened2, TEXTS.forced2, TEXTS.winners2, TEXTS.applied2, TEXTS.finished,
];
