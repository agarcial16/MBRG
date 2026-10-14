// FR-31, FR-32, FR-45: input checks for seed and round. Inputs are `unknown`.

/** FR-31: a seed is a number that is an integer from 0 to 2^32 - 1 (-0 counts as 0). */
export function checkSeed(seed: unknown): seed is number {
  return typeof seed === 'number' && Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff;
}

/** FR-45: a round is a number that is an integer >= 0 (-0 counts as 0). */
export function checkRound(round: unknown): round is number {
  return typeof round === 'number' && Number.isInteger(round) && round >= 0;
}
