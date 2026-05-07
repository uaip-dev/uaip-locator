/**
 * Journey scoring constants + helpers.
 *
 * Scoring is deliberately small and transparent — no ML, no tuning dataset.
 * We want journey ranking to be deterministic and debuggable: every point
 * a journey accrues has a one-line reason we can surface in the dashboard.
 *
 * If ranking drifts in a way that's obviously wrong on a real customer
 * crawl, adjust the weights here rather than adding new signals; the
 * point of this layer is to stay cheap and explainable.
 */
import type { PageCategory } from "../types/index.js";

/**
 * Labels that mark the *end* of a valuable flow. Reaching one of these is
 * the strongest positive signal: an "order-confirm" or "logout-confirm"
 * page is unambiguously the goal of a user journey, so journeys that end
 * here get the biggest bonus.
 */
export const TERMINAL_LABELS: ReadonlySet<string> = new Set([
  "order-confirm",
  "delete-account",
  "logout-confirm",
]);

/**
 * Labels we prefer as starting points. A journey that begins at "login"
 * or "product-list" is a canonical smoke entry point; one that begins on
 * a random settings sub-page is rarely interesting end-to-end.
 */
export const STARTING_LABELS: ReadonlySet<string> = new Set([
  "login",
  "signup",
  "home",
  "product-list",
]);

/**
 * Per-category weights. `shell` deliberately zero — a journey that only
 * touches nav/footer pages isn't a user flow. `errors` slightly negative
 * so landing on a 404 reduces rather than raises the score.
 */
export const CATEGORY_WEIGHTS: Record<PageCategory, number> = {
  auth: 1.5,
  commerce: 2,
  content: 0.5,
  account: 1,
  shell: 0,
  errors: -0.5,
};

/** Per-node base value added when that node is hit. */
export const CATEGORY_HIT_MULTIPLIER = 1;
/** Bonus when a terminal label is the final node. */
export const TERMINAL_BONUS = 3;
/** Bonus when a starting label is the first node. */
export const STARTING_BONUS = 2;
/** Penalty per edge (discourages meandering paths). */
export const PATH_LENGTH_PENALTY = 0.5;

/**
 * Score a single journey given its label sequence. Exposed so tests and
 * the dashboard can rebuild the breakdown without re-running the full
 * graph search.
 */
export function scoreJourney(
  labels: string[],
  categories: PageCategory[],
): number {
  if (labels.length === 0) return 0;

  let score = 0;

  // Per-node category weights. Duplicates count once per visit —
  // journeys are simple paths so this is already bounded.
  for (const cat of categories) {
    score += (CATEGORY_WEIGHTS[cat] ?? 0) * CATEGORY_HIT_MULTIPLIER;
  }

  const first = labels[0];
  const last = labels[labels.length - 1];

  if (first !== undefined && STARTING_LABELS.has(first)) {
    score += STARTING_BONUS;
  }
  if (last !== undefined && TERMINAL_LABELS.has(last)) {
    score += TERMINAL_BONUS;
  }

  // path length = edges = nodes - 1. A single-node journey has no edges
  // and pays no penalty, but will also score low on its own merits.
  const edgeCount = Math.max(0, labels.length - 1);
  score -= edgeCount * PATH_LENGTH_PENALTY;

  return round2(score);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
