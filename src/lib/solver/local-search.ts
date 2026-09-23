/**
 * Local search over a finished itinerary.
 *
 * ## What the objective actually is
 *
 * This is an orienteering problem, not a travelling-salesman problem. The score
 * is the total value of the stops visited, subject to a time budget; see
 * `realisedScore` in ./score.ts for the exact quantity the benchmark measures.
 * That quantity depends only on WHICH candidates are in the plan — the variety
 * term is always 0 for a stop already in the plan, so nothing in the score
 * depends on the order of the stops.
 *
 * The direct consequence: **a pure 2-opt buys exactly zero score.** Shortening
 * the tour is worth nothing on its own. It is worth something only because the
 * time it frees can then be spent on a stop that previously did not fit. So the
 * search runs four phases in a loop, of which the first two are useless apart:
 *
 *   1. COMPACT — reorder the existing stops to finish earlier (2-opt segment
 *      reversal and Or-opt relocation of runs of 1..3). Score-neutral by
 *      construction; accepted only when the day gets strictly shorter.
 *   2. FILL — insert candidates that did not previously fit, at every feasible
 *      position, into the time compaction just freed.
 *   3. SWAP — exchange a low-value stop for a higher-value one that did not fit.
 *   4. EJECT — drop one stop and re-run compact+fill, keeping the result only
 *      if the total score strictly improves.
 *
 * repeated until a full pass changes nothing.
 *
 * Or-opt and eject are implemented but off by default because the benchmark
 * says they do not pay for their solve time here. See DEFAULT_MOVES.
 *
 * ## Feasibility
 *
 * Every single candidate move is checked by `buildTimeline()` — the same shared
 * function the greedy solver and the invariant tests use. There is deliberately
 * no cheaper or more permissive feasibility path in this file: opening hours,
 * the budget and the return leg are decided in exactly one place. A move whose
 * timeline comes back null is simply not available.
 *
 * ## Why this can never score worse than greedy
 *
 * The search starts from `solveGreedy()`'s own output and only ever commits a
 * move that (a) strictly increases the realised total score, or (b) leaves the
 * score untouched and strictly shortens the day. So `greedy+local >= greedy` on
 * every scenario, by construction rather than by observation. If the benchmark
 * ever reports a loss against greedy, that is a bug in this file.
 *
 * One caveat on "untouched": the reported total is summed over the stops in tour
 * order, so a pure reordering can move the total by one unit in the last place
 * of a double (order 1e-15). The benchmark's tie threshold is 1e-9, so that
 * shows up as a tie, which is what it is. A delta of -1e-15 is float summation,
 * not a solver that lost ground.
 *
 * ## Termination and complexity
 *
 * With n stops in the tour and m unused candidates, one pass costs
 * O(n^3) timeline builds for compact, O(m*n^2) for fill and O(m*n^3) for swap,
 * each build itself O(n). Here n <= ~15 and m <= ~37, so a pass is thousands of
 * builds and runs in single-digit milliseconds.
 *
 * Termination is guaranteed twice over. Compact moves strictly decrease an
 * integer (elapsed seconds) that is bounded below; fill and swap strictly
 * increase a score bounded above by the value of all candidates. On top of that
 * both a pass cap and a hard budget on `buildTimeline` calls are enforced, so a
 * pathological instance stops early with the best solution found rather than
 * hanging.
 *
 * ## Determinism
 *
 * No randomness anywhere. Candidates are iterated in `req.candidates` order,
 * positions in index order, and every comparison is strict (`>` / `<`) so the
 * first move found wins any tie. Same input, same output, always.
 */
import { buildTimeline, type Timeline } from './timeline';
import { explainRejections, solveGreedy } from './greedy';
import { realisedScore, scoreCandidate } from './score';
import {
  DEFAULT_WEIGHTS,
  type Candidate,
  type SolveRequest,
  type Solution,
  type Solver,
  type Stop,
} from './types';

/** Longest run of consecutive stops Or-opt will pick up and move. */
const MAX_OR_OPT_RUN = 3;

/** Which moves are enabled. Exposed so the benchmark can ablate them honestly. */
export type MoveSet = {
  /** Reverse a segment of the tour. Score-neutral; run for the time it frees. */
  twoOpt: boolean;
  /** Relocate a run of 1..MAX_OR_OPT_RUN stops elsewhere, either orientation. */
  orOpt: boolean;
  /** Insert a candidate that did not previously fit. This is where score comes from. */
  insert: boolean;
  /** Replace a stop with a higher-value candidate that did not fit. */
  swap: boolean;
  /** Drop a stop and refill, committing only on a strict score gain. */
  eject: boolean;
};

export type LocalSearchOptions = MoveSet & {
  /** Hard cap on outer passes. */
  maxPasses: number;
  /** Hard cap on `buildTimeline` calls, so a pathological case cannot hang. */
  maxEvaluations: number;
};

/**
 * The default move set, chosen by measurement rather than by taste.
 *
 * Gain over the greedy tour the search starts from, pooled over 550 seeded
 * scenarios (eight seeds), against the cost in `buildTimeline` calls on the
 * 50-scenario benchmark — see docs/benchmark.md, which regenerates all of it:
 *
 *   moves                          gain     checks mean/worst
 *   insert + swap, no reordering   +4.35%      2946 / 13617
 *   2-opt + insert + swap          +5.33%      3361 / 13055   <- default
 *   Or-opt + insert + swap         +5.39%      5415 / 18910
 *   both reorders + insert + swap  +5.45%      5645 / 20853
 *   default + eject                +6.05%     14724 / 60964
 *
 * So `orOpt` and `eject` are implemented but off.
 *
 * 2-opt and Or-opt turn out to be near-substitutes here: either one alone
 * captures about a full point of the 1.1 points reordering is worth, and
 * running the second as well buys 0.12 points — inside the spread between
 * seeds, and on the default benchmark seed it is actually 0.09 points worse —
 * for two-thirds more feasibility checks. That is not a move earning its place.
 *
 * Eject is a real 0.7 points, but at four and a half times the work of the
 * default, which is the wrong trade for a solver that runs inside a page
 * render. It is the first thing to switch on for an offline or batch caller.
 *
 * Both stay in the file, switched off and measured by the ablation in
 * src/lib/benchmark/ablation.ts, because they are the right moves to reach for
 * on a larger candidate set where the day is not already saturated. Flip them
 * on and re-run the benchmark; do not guess.
 */
export const DEFAULT_MOVES: LocalSearchOptions = {
  twoOpt: true,
  orOpt: false,
  insert: true,
  swap: true,
  eject: false,
  maxPasses: 24,
  maxEvaluations: 250_000,
};

export type LocalSearchStats = {
  passes: number;
  twoOptApplied: number;
  orOptApplied: number;
  inserted: number;
  swapped: number;
  ejected: number;
  /** How many times `buildTimeline` was called. The real cost of the search. */
  evaluations: number;
  /** True when the evaluation budget ran out before the search converged. */
  budgetExhausted: boolean;
  startScore: number;
  endScore: number;
  startStops: number;
  endStops: number;
  startElapsedS: number;
  endElapsedS: number;
  /** Seconds of day length the compact phase freed, before refilling. */
  timeFreedS: number;
};

/** Counts and caps every feasibility check. The only route to `buildTimeline`. */
function makeEvaluator(req: SolveRequest, budget: number) {
  const state = { calls: 0, exhausted: false };
  return {
    state,
    build(order: readonly Candidate[]): Timeline | null {
      if (state.calls >= budget) {
        state.exhausted = true;
        return null;
      }
      state.calls += 1;
      return buildTimeline(order, req);
    },
  };
}

type Evaluator = ReturnType<typeof makeEvaluator>;

/**
 * True when the span [from..to] contains a locked stop.
 *
 * `lockedIds` is documented as "must appear in the result, in any order", so the
 * binding promise is membership, not position. This guard is the stricter
 * reading: a locked stop is never itself picked up and carried somewhere else,
 * only ever stepped around. Other stops may still move past it, and an
 * insertion elsewhere may shift its index — neither relocates the stop.
 */
function spanHasLocked(
  order: readonly Candidate[],
  from: number,
  to: number,
  locked: ReadonlySet<number>,
): boolean {
  if (locked.size === 0) return false;
  for (let i = from; i <= to; i += 1) if (locked.has(order[i].id)) return true;
  return false;
}

type Reorder = { order: Candidate[]; elapsedS: number; kind: 'two-opt' | 'or-opt' };

/**
 * The single best time-saving reordering of `order`, or null if none exists.
 *
 * Best-improvement rather than first-improvement: it costs one extra sweep but
 * makes the result independent of the order moves happen to be generated in,
 * which is one less thing that can silently change a benchmark number.
 */
function bestReorder(
  order: readonly Candidate[],
  baseElapsedS: number,
  ev: Evaluator,
  locked: ReadonlySet<number>,
  opts: MoveSet,
): Reorder | null {
  const n = order.length;
  if (n < 2) return null;
  let best: Reorder | null = null;

  const consider = (next: Candidate[], kind: Reorder['kind']) => {
    const t = ev.build(next);
    if (!t) return;
    if (t.totalElapsedS >= baseElapsedS) return;
    if (best && t.totalElapsedS >= best.elapsedS) return;
    best = { order: next, elapsedS: t.totalElapsedS, kind };
  };

  if (opts.twoOpt) {
    for (let i = 0; i < n - 1; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        if (spanHasLocked(order, i, j, locked)) continue;
        consider(
          [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)],
          'two-opt',
        );
      }
    }
  }

  if (opts.orOpt) {
    for (let len = 1; len <= Math.min(MAX_OR_OPT_RUN, n); len += 1) {
      for (let i = 0; i + len <= n; i += 1) {
        if (spanHasLocked(order, i, i + len - 1, locked)) continue;
        const run = order.slice(i, i + len);
        const rest = [...order.slice(0, i), ...order.slice(i + len)];
        const reversed = [...run].reverse();
        for (let j = 0; j <= rest.length; j += 1) {
          // Putting the run straight back where it came from is a no-op.
          if (j !== i) consider([...rest.slice(0, j), ...run, ...rest.slice(j)], 'or-opt');
          // Reversing a run of one is a no-op. Reversing it in place is a real
          // move, but 2-opt already generates it, so only do it here when 2-opt
          // is switched off.
          if (len > 1 && !(j === i && opts.twoOpt)) {
            consider([...rest.slice(0, j), ...reversed, ...rest.slice(j)], 'or-opt');
          }
        }
      }
    }
  }

  return best;
}

type Insertion = { order: Candidate[]; candidate: Candidate; ratio: number; elapsedS: number };

/**
 * The best single insertion of an unused candidate, by score per minute added.
 *
 * Ranked the same way greedy ranks its own insertions, deliberately: the point
 * of this phase is to carry on where greedy stopped, not to apply a different
 * notion of value at the last moment.
 */
function bestInsertion(
  order: readonly Candidate[],
  unused: readonly Candidate[],
  baseElapsedS: number,
  ev: Evaluator,
  value: (c: Candidate) => number,
): Insertion | null {
  let best: Insertion | null = null;

  for (const candidate of unused) {
    const v = value(candidate);
    if (v <= 0) continue;

    for (let i = 0; i <= order.length; i += 1) {
      const next = [...order.slice(0, i), candidate, ...order.slice(i)];
      const t = ev.build(next);
      if (!t) continue;

      const addedMin = (t.totalElapsedS - baseElapsedS) / 60;
      const ratio = v / Math.max(addedMin, 1 / 60);
      if (!best || ratio > best.ratio) {
        best = { order: next, candidate, ratio, elapsedS: t.totalElapsedS };
      }
    }
  }

  return best;
}

type Swap = { order: Candidate[]; gain: number; elapsedS: number };

/**
 * The best exchange of one scheduled stop for one unused higher-value candidate.
 *
 * The replacement is tried at every position, not just the vacated one — the
 * whole reason a better candidate did not fit is usually that it belongs
 * somewhere else in the day.
 */
function bestSwap(
  order: readonly Candidate[],
  unused: readonly Candidate[],
  ev: Evaluator,
  value: (c: Candidate) => number,
  locked: ReadonlySet<number>,
): Swap | null {
  let best: Swap | null = null;

  for (let i = 0; i < order.length; i += 1) {
    const out = order[i];
    if (locked.has(out.id)) continue;
    const rest = [...order.slice(0, i), ...order.slice(i + 1)];
    const outValue = value(out);

    for (const candidate of unused) {
      const gain = value(candidate) - outValue;
      if (gain <= 0) continue;

      for (let j = 0; j <= rest.length; j += 1) {
        const next = [...rest.slice(0, j), candidate, ...rest.slice(j)];
        const t = ev.build(next);
        if (!t) continue;
        const better =
          !best || gain > best.gain || (gain === best.gain && t.totalElapsedS < best.elapsedS);
        if (better) best = { order: next, gain, elapsedS: t.totalElapsedS };
      }
    }
  }

  return best;
}

/** Candidates not currently in the tour, in stable `req.candidates` order. */
function unusedFrom(all: readonly Candidate[], order: readonly Candidate[]): Candidate[] {
  const chosen = new Set(order.map((c) => c.id));
  return all.filter((c) => !chosen.has(c.id));
}

export type ImproveResult = {
  order: Candidate[];
  timeline: Timeline;
  stats: LocalSearchStats;
};

/**
 * Improve a finished tour in place of the clock, not in place of the score.
 *
 * `start` must already be a feasible order — normally the stop list of a
 * solution from another solver. Returns the improved order plus statistics.
 */
export function improve(
  start: readonly Candidate[],
  req: SolveRequest,
  options: Partial<LocalSearchOptions> = {},
): ImproveResult {
  const opts = { ...DEFAULT_MOVES, ...options };
  const weights = req.weights ?? DEFAULT_WEIGHTS;
  const locked = new Set(req.lockedIds ?? []);
  const ev = makeEvaluator(req, opts.maxEvaluations);

  const valueCache = new Map<number, number>();
  const value = (c: Candidate): number => {
    const hit = valueCache.get(c.id);
    if (hit !== undefined) return hit;
    const v = realisedScore(c, req.interests, weights);
    valueCache.set(c.id, v);
    return v;
  };
  const totalValue = (o: readonly Candidate[]) => o.reduce((sum, c) => sum + value(c), 0);

  let order = [...start];
  let timeline = ev.build(order);
  if (!timeline) {
    // The caller handed us an order `buildTimeline` rejects. That is a bug in
    // the caller, not something to repair by relaxing a constraint, so fall
    // back to the empty day — the one order that is always legal — rather than
    // returning a tour and a timeline that disagree about what is in the plan.
    const emptyOrder: Candidate[] = [];
    return {
      order: emptyOrder,
      timeline: buildTimeline(emptyOrder, req)!,
      stats: blankStats(0, 0, 0, ev),
    };
  }

  const stats: LocalSearchStats = {
    passes: 0,
    twoOptApplied: 0,
    orOptApplied: 0,
    inserted: 0,
    swapped: 0,
    ejected: 0,
    evaluations: 0,
    budgetExhausted: false,
    startScore: totalValue(order),
    endScore: 0,
    startStops: order.length,
    endStops: 0,
    startElapsedS: timeline.totalElapsedS,
    endElapsedS: 0,
    timeFreedS: 0,
  };

  /** Phase 1. Shorten the day without touching which stops are in it. */
  const compact = (): boolean => {
    let changed = false;
    for (let guard = 0; guard < opts.maxPasses * 4; guard += 1) {
      const move = bestReorder(order, timeline!.totalElapsedS, ev, locked, opts);
      if (!move) break;
      stats.timeFreedS += timeline!.totalElapsedS - move.elapsedS;
      if (move.kind === 'two-opt') stats.twoOptApplied += 1;
      else stats.orOptApplied += 1;
      order = move.order;
      timeline = buildTimeline(order, req)!;
      changed = true;
    }
    return changed;
  };

  /** Phase 2. Spend the freed time. */
  const fill = (): boolean => {
    let changed = false;
    for (let guard = 0; guard <= req.candidates.length; guard += 1) {
      const unused = unusedFrom(req.candidates, order);
      if (unused.length === 0) break;
      const move = bestInsertion(order, unused, timeline!.totalElapsedS, ev, value);
      if (!move) break;
      order = move.order;
      timeline = buildTimeline(order, req)!;
      stats.inserted += 1;
      changed = true;
    }
    return changed;
  };

  /** Phase 3. Trade a weak stop for a strong one that could not fit. */
  const swap = (): boolean => {
    const unused = unusedFrom(req.candidates, order);
    if (unused.length === 0) return false;
    const move = bestSwap(order, unused, ev, value, locked);
    if (!move) return false;
    order = move.order;
    timeline = buildTimeline(order, req)!;
    stats.swapped += 1;
    return true;
  };

  /**
   * Phase 4. Drop one stop, compact and refill, keep only on a strict gain.
   *
   * This is the one move that can temporarily make the solution worse, so it is
   * evaluated on a copy and committed only when the score comes out ahead.
   */
  const eject = (): boolean => {
    const current = totalValue(order);
    let best: { order: Candidate[]; score: number } | null = null;

    for (let i = 0; i < order.length; i += 1) {
      if (locked.has(order[i].id)) continue;
      const trial = [...order.slice(0, i), ...order.slice(i + 1)];
      let trialTimeline = ev.build(trial);
      if (!trialTimeline) continue;

      let trialOrder = trial;
      for (let guard = 0; guard < opts.maxPasses; guard += 1) {
        const re = bestReorder(trialOrder, trialTimeline.totalElapsedS, ev, locked, opts);
        if (!re) break;
        trialOrder = re.order;
        trialTimeline = buildTimeline(trialOrder, req)!;
      }
      for (let guard = 0; guard <= req.candidates.length; guard += 1) {
        const unused = unusedFrom(req.candidates, trialOrder);
        if (unused.length === 0) break;
        const ins = bestInsertion(trialOrder, unused, trialTimeline.totalElapsedS, ev, value);
        if (!ins) break;
        trialOrder = ins.order;
        trialTimeline = buildTimeline(trialOrder, req)!;
      }

      const score = totalValue(trialOrder);
      if (score > current && (!best || score > best.score)) {
        best = { order: trialOrder, score };
      }
    }

    if (!best) return false;
    order = best.order;
    timeline = buildTimeline(order, req)!;
    stats.ejected += 1;
    return true;
  };

  for (let pass = 0; pass < opts.maxPasses; pass += 1) {
    stats.passes = pass + 1;

    let changed = false;
    if (opts.twoOpt || opts.orOpt) changed = compact() || changed;
    if (opts.insert) changed = fill() || changed;
    if (opts.swap && swap()) changed = true;
    if (!changed && opts.eject && eject()) changed = true;

    if (!changed) break;
    if (ev.state.exhausted) break;
  }

  stats.evaluations = ev.state.calls;
  stats.budgetExhausted = ev.state.exhausted;
  stats.endScore = totalValue(order);
  stats.endStops = order.length;
  stats.endElapsedS = timeline.totalElapsedS;

  return { order, timeline, stats };
}

function blankStats(
  score: number,
  stops: number,
  elapsedS: number,
  ev: Evaluator,
): LocalSearchStats {
  return {
    passes: 0,
    twoOptApplied: 0,
    orOptApplied: 0,
    inserted: 0,
    swapped: 0,
    ejected: 0,
    evaluations: ev.state.calls,
    budgetExhausted: ev.state.exhausted,
    startScore: score,
    endScore: score,
    startStops: stops,
    endStops: stops,
    startElapsedS: elapsedS,
    endElapsedS: elapsedS,
    timeFreedS: 0,
  };
}

/**
 * Greedy insertion, then local search.
 *
 * Returns the stats alongside the solution so the benchmark can report how much
 * work the search did and which moves paid for themselves, without bolting a
 * diagnostics field onto the shared `Solution` type.
 */
export function solveGreedyLocalWithStats(
  req: SolveRequest,
  options: Partial<LocalSearchOptions> = {},
): { solution: Solution; stats: LocalSearchStats } {
  const started = Date.now();
  const weights = req.weights ?? DEFAULT_WEIGHTS;
  const lockedIds = new Set(req.lockedIds ?? []);

  // Start from exactly what greedy produces. Not a re-run with different
  // tie-breaks, not a fresh construction: the same tour, so any difference in
  // the benchmark is attributable to the moves below and nothing else.
  const base = solveGreedy(req);
  const { order, timeline, stats } = improve(
    base.stops.map((s) => s.candidate),
    req,
    options,
  );

  // Scored exactly as greedy scores its own result: against the finished day's
  // category set, which zeroes the variety term for every chosen stop.
  const chosenCategories = new Set(order.flatMap((c) => c.categories));
  const scores = new Map(
    order.map((c) => [
      c.id,
      scoreCandidate(c, req.interests, new Set(chosenCategories), weights),
    ]),
  );

  const stops: Stop[] = timeline.stops.map((s) => ({
    ...s,
    score: scores.get(s.candidate.id) ?? 0,
    locked: lockedIds.has(s.candidate.id),
  }));

  const placed = new Set(order.map((c) => c.id));
  const leftovers = req.candidates.filter((c) => !placed.has(c.id));

  const solution: Solution = {
    stops,
    returnTravelS: timeline.returnTravelS,
    endAt: timeline.endAt,
    totalTravelS: timeline.totalTravelS,
    totalVisitS: timeline.totalVisitS,
    totalElapsedS: timeline.totalElapsedS,
    totalScore: stops.reduce((sum, s) => sum + s.score, 0),
    slackS: req.budgetMin * 60 - timeline.totalElapsedS,
    rejected: explainRejections(leftovers, order, req, weights),
    solver: 'greedy+local',
    solveMs: Date.now() - started,
  };

  return { solution, stats };
}

export function solveGreedyLocal(req: SolveRequest): Solution {
  return solveGreedyLocalWithStats(req).solution;
}

export const GREEDY_LOCAL: Solver = {
  name: 'greedy+local',
  label: 'Greedy + local search',
  solve: solveGreedyLocal,
};
