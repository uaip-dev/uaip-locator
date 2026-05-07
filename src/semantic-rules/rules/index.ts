/**
 * Rule registry + runner.
 *
 * The registry is a flat array — ordering is irrelevant because `applyPageRules`
 * sorts matches by confidence. All rules run on every page; the 39-rule
 * registry is O(1) relative to crawl size and measured at <5ms per page on
 * a mid-range laptop, so there's no reason to make it conditional.
 */
import type { PageLabel, PageSnapshot } from "../../types/index.js";
import type { PageRule } from "./types.js";

import accountRules from "./account.js";
import authRules from "./auth.js";
import commerceRules from "./commerce.js";
import contentRules from "./content.js";
import errorsRules from "./errors.js";
import shellRules from "./shell.js";

/** Every registered page rule. Flat list across all six categories. */
export const ALL_RULES: PageRule[] = [
  ...authRules,
  ...commerceRules,
  ...contentRules,
  ...accountRules,
  ...shellRules,
  ...errorsRules,
];

/** Minimum confidence for a rule's match to be reported. */
export const MIN_CONFIDENCE = 0.5;

/**
 * Apply every rule to a single page and return the matches, sorted by
 * confidence desc. Matches below MIN_CONFIDENCE are filtered out.
 */
export function applyPageRules(
  page: PageSnapshot,
  rules: PageRule[] = ALL_RULES,
): PageLabel[] {
  const out: PageLabel[] = [];
  for (const rule of rules) {
    let conf: number | null = null;
    try {
      conf = rule.match(page);
    } catch {
      // A broken rule should never kill the crawl.
      continue;
    }
    if (conf === null) continue;
    if (conf < MIN_CONFIDENCE) continue;
    out.push({
      label: rule.label,
      category: rule.category,
      confidence: clamp(conf),
      ruleId: rule.id,
    });
  }
  out.sort((a, b) => b.confidence - a.confidence);
  return out;
}

/**
 * Apply rules to every page of a crawl. Returns a {url -> PageLabel[]} map
 * suitable for assignment to `CrawlResult.pageLabels`.
 */
export function labelPages(
  pages: PageSnapshot[],
  rules: PageRule[] = ALL_RULES,
): Record<string, PageLabel[]> {
  const out: Record<string, PageLabel[]> = {};
  for (const page of pages) {
    const matches = applyPageRules(page, rules);
    if (matches.length > 0) out[page.url] = matches;
  }
  return out;
}

/**
 * Pick the "best" label for naming purposes — highest confidence among
 * non-shell categories, falling back to shell if that's all that's there.
 * Used by the codegen to name page objects and test methods.
 */
export function primaryLabel(matches: PageLabel[] | undefined): PageLabel | null {
  if (!matches || matches.length === 0) return null;
  const nonShell = matches.filter((m) => m.category !== "shell");
  return (nonShell[0] ?? matches[0]) ?? null;
}

function clamp(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export type { PageRule } from "./types.js";
