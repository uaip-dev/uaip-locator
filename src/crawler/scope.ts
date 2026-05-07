/**
 * Scope rules for multi-page crawling.
 *
 * Used by the BFS loop to decide whether a freshly-discovered link should be
 * enqueued or dropped. Evaluation order inside `inScope`:
 *
 *   1. sameOrigin gate    — reject anything not matching the start URL's origin.
 *   2. pathPrefix gate    — if set, reject URLs whose pathname doesn't start
 *                           with the prefix.
 *   3. exclude patterns   — any match → reject (veto).
 *   4. include patterns   — if present, must match at least one; otherwise
 *                           pass through.
 *
 * Patterns are regexes over the *normalised* URL string (including scheme,
 * host, path, and sorted query). This lets users scope by query, not just
 * path, when they need to.
 */

import { originOf, pathnameOf } from "./normalize.js";

export interface ScopeRules {
  /** When true, reject URLs whose origin differs from `origin`. Default true. */
  sameOrigin: boolean;
  /** The origin of the start URL — used by the sameOrigin check. */
  origin: string;
  /** Optional path-prefix gate (e.g. "/admin"). Matched against pathname. */
  pathPrefix?: string;
  /** URLs matching any of these are rejected. */
  include?: RegExp[];
  /** URLs matching any of these are rejected (evaluated before include). */
  exclude?: RegExp[];
}

export function inScope(normalisedUrl: string, rules: ScopeRules): boolean {
  if (rules.sameOrigin) {
    const origin = originOf(normalisedUrl);
    if (origin === null || origin !== rules.origin) return false;
  }

  if (rules.pathPrefix) {
    const path = pathnameOf(normalisedUrl);
    if (!path.startsWith(rules.pathPrefix)) return false;
  }

  if (rules.exclude) {
    for (const re of rules.exclude) {
      if (re.test(normalisedUrl)) return false;
    }
  }

  if (rules.include && rules.include.length > 0) {
    let matched = false;
    for (const re of rules.include) {
      if (re.test(normalisedUrl)) {
        matched = true;
        break;
      }
    }
    if (!matched) return false;
  }

  return true;
}

/**
 * Build a ScopeRules from loose user input (CLI / JSON config). Invalid
 * regex strings throw with a helpful message rather than silently being
 * ignored — a broken scope rule should stop the crawl, not widen it.
 */
export function buildScopeRules(input: {
  origin: string;
  sameOrigin?: boolean;
  pathPrefix?: string;
  include?: string[];
  exclude?: string[];
}): ScopeRules {
  const rules: ScopeRules = {
    sameOrigin: input.sameOrigin ?? true,
    origin: input.origin,
  };
  if (input.pathPrefix) rules.pathPrefix = input.pathPrefix;
  if (input.include && input.include.length > 0) {
    rules.include = input.include.map((s) => compileRegex(s, "include"));
  }
  if (input.exclude && input.exclude.length > 0) {
    rules.exclude = input.exclude.map((s) => compileRegex(s, "exclude"));
  }
  return rules;
}

function compileRegex(pattern: string, kind: "include" | "exclude"): RegExp {
  try {
    return new RegExp(pattern);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid ${kind} regex ${JSON.stringify(pattern)}: ${msg}`);
  }
}
