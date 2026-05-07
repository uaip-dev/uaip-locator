/**
 * Rule-based page labelling — type surface.
 *
 * Each rule is a pure, synchronous function over a single PageSnapshot. No
 * I/O, no LLM, no shared state. That constraint is load-bearing: rules run
 * on every page of every crawl, unconditionally, so they must be cheap and
 * deterministic. LLM-assisted labels live in a separate pipeline (labeler.ts).
 */
import type { PageCategory, PageSnapshot } from "../../types/index.js";

/**
 * A single matcher. Return a confidence in [0..1] when the rule fires, else
 * null when it does not apply. Callers stable-sort matches by confidence
 * desc and take the top N.
 *
 * Confidence convention (ballpark — rules are heuristics, not probabilities):
 *   >= 0.9   structural certainty (e.g. exactly one email input + one password input)
 *   >= 0.7   strong evidence (heading text + form fields match category)
 *   >= 0.5   good single signal (URL pattern alone)
 *   <  0.5   don't emit — below this we prefer to stay silent
 */
export interface PageRule {
  /** Stable machine-readable id — used as ruleId in PageLabel output. */
  id: string;
  /** Label emitted when this rule fires. Often matches id, but may not. */
  label: string;
  /** Broad grouping for the dashboard. */
  category: PageCategory;
  /** One-line description of what the rule looks for. */
  description: string;
  /** Match predicate. */
  match: (page: PageSnapshot) => number | null;
}
