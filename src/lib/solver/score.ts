import { DEFAULT_WEIGHTS, type Candidate, type ScoringWeights } from './types';

/**
 * How well a candidate matches the user's stated interests, 0..10.
 *
 * No interests stated means no signal either way, so everything scores neutral
 * rather than zero — otherwise the interest term would flatten the ranking to
 * popularity alone in a way that looks like a bug.
 */
export function interestScore(candidate: Candidate, interests: readonly string[]): number {
  if (interests.length === 0) return 5;
  const hits = candidate.categories.filter((c) => interests.includes(c)).length;
  if (hits === 0) return 0;
  // One match earns most of the credit; further matches add less.
  return Math.min(10, 7 + 3 * (hits - 1));
}

/**
 * Rewards a candidate for adding a category the day does not have yet, 0..10.
 * This is what stops a food-and-history day becoming four museums in a row.
 */
export function varietyScore(
  candidate: Candidate,
  chosenCategories: ReadonlySet<string>,
): number {
  const fresh = candidate.categories.filter((c) => !chosenCategories.has(c)).length;
  if (fresh === 0) return 0;
  return fresh === candidate.categories.length ? 10 : 6;
}

/**
 * A candidate's value to this user right now, 0..10.
 *
 * Geographic coherence is deliberately NOT a term here. The solver divides score
 * by the minutes a stop adds, so a place that is far away is already penalised
 * in proportion to the detour it causes. Folding distance in twice would
 * double-count it.
 */
export function scoreCandidate(
  candidate: Candidate,
  interests: readonly string[],
  chosenCategories: ReadonlySet<string>,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
): number {
  const popularity = Math.max(0, Math.min(10, candidate.popularity));
  return (
    weights.popularity * popularity +
    weights.interest * interestScore(candidate, interests) +
    weights.variety * varietyScore(candidate, chosenCategories)
  );
}
