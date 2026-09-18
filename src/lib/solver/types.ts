import type { Coord } from '../geo';

/** A half-open opening window, in minutes from local midnight. */
export type OpenWindow = {
  /** 0 = Sunday .. 6 = Saturday. */
  day: number;
  opensMin: number;
  closesMin: number;
};

export type Hours =
  | { kind: 'always' }
  /** Source data could not be parsed. Treated as open, but flagged. */
  | { kind: 'unknown' }
  | { kind: 'windows'; windows: OpenWindow[] };

/** A place the solver may choose to include. */
export type Candidate = {
  id: number;
  name: string;
  location: Coord;
  /** Typical dwell time. Drives the budget. */
  visitDurationMin: number;
  /** 0..10, blended from ratings and source signals. */
  popularity: number;
  /** Category slugs, e.g. ['history', 'views']. First is the primary. */
  categories: string[];
  hours: Hours;
};

export type ScoringWeights = {
  popularity: number;
  interest: number;
  variety: number;
};

export const DEFAULT_WEIGHTS: ScoringWeights = {
  popularity: 0.45,
  interest: 0.35,
  variety: 0.2,
};

/** Seconds of travel between two points. Injected so Phase 2 can swap in the matrix. */
export type TravelFn = (from: Coord, to: Coord) => number;

export type SolveRequest = {
  start: Coord;
  /** Local wall-clock start. Opening hours are compared in this same frame. */
  startAt: Date;
  budgetMin: number;
  /** Category slugs the user picked. Empty means no preference. */
  interests: string[];
  candidates: Candidate[];
  travelSeconds: TravelFn;
  weights?: ScoringWeights;
  /** Candidate ids that must appear in the result, in any order. */
  lockedIds?: number[];
};

/** Every algorithm that can produce a Solution. Benchmarked against each other. */
export type SolverName = 'popularity-first' | 'greedy';

export type Stop = {
  candidate: Candidate;
  seq: number;
  arriveAt: Date;
  departAt: Date;
  travelFromPrevS: number;
  /** The candidate's score, for explaining the plan. */
  score: number;
  locked: boolean;
};

/**
 * Why a candidate did not make the plan.
 *  - `closed`    shut on the chosen day
 *  - `too-long`  will not fit the budget even as the only stop of the day
 *  - `day-full`  fits on its own, but not alongside stops that scored higher
 */
export type RejectionReason = 'closed' | 'too-long' | 'day-full';

export type Rejection = {
  candidate: Candidate;
  reason: RejectionReason;
};

export type Solution = {
  stops: Stop[];
  /** Travel from the last stop back to the start point. */
  returnTravelS: number;
  endAt: Date;
  totalTravelS: number;
  totalVisitS: number;
  totalElapsedS: number;
  totalScore: number;
  /** Budget left over, in seconds. Never negative for a valid solution. */
  slackS: number;
  /** Why strong candidates did not make it. Powers the "why this plan" view. */
  rejected: Rejection[];
  solver: SolverName;
  solveMs: number;
};

/** The shape every solver shares, so the benchmark can run them uniformly. */
export type Solver = {
  name: SolverName;
  /** Shown in the benchmark table. */
  label: string;
  solve: (req: SolveRequest) => Solution;
};
