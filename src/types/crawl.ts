/**
 * CrawlResult — what the crawler hands to the selector engine and codegen.
 *
 * Supports both single-page (V1) and multi-page (V1.1) crawls. The schema is
 * additive: multi-page adds `edges`/`failures` and populates `pages[]` with
 * N > 1 entries. Consumers that only look at `pages[0]` keep working.
 */

import type { UiElement } from "./elements.js";
import type { SelectorBundle } from "./selectors.js";

export interface PageSnapshot {
  /** Resolved URL after redirects. */
  url: string;

  /** <title> at crawl time. */
  title: string;

  /** Viewport the crawl ran at. */
  viewport: { width: number; height: number };

  /** ISO timestamp of the crawl. */
  crawledAt: string;

  /** Elements discovered on this page. */
  elements: UiElement[];

  /**
   * Playwright's ARIA accessibility tree for the page. Kept as opaque JSON
   * here because the node shape is Playwright-version-specific — downstream
   * consumers that need typed access should parse it themselves.
   */
  ariaSnapshot?: unknown;
}

export interface CrawlResult {
  /** Schema version — bumped when `CrawlResult` shape changes. */
  schemaVersion: 1;

  /** What was asked of the crawler. Preserved for reproducibility. */
  target: {
    url: string;
    viewport: { width: number; height: number };
    userAgent?: string;
  };

  /** One entry per successfully-crawled page. Length >= 1. */
  pages: PageSnapshot[];

  /**
   * Selector bundles per element (keyed by uaipId). May be populated by the
   * selector engine as a post-processing step, so this field is optional
   * during the crawler's own output.
   */
  selectors?: Record<string, SelectorBundle>;

  /**
   * Semantic labels per element (keyed by uaipId) — populated by the
   * optional LLM pass. Each entry is a short camelCase intent name like
   * `primaryLoginButton` or `usernameInput`. Present only when the crawl
   * was run with the `--semantic` flag and labelling succeeded.
   */
  semanticLabels?: Record<string, string>;

  /**
   * Rule-based page-type labels per URL — populated deterministically on
   * every crawl (no LLM). Each entry is a sorted list of matches, highest
   * confidence first. E.g. {"/login": [{label:"login",confidence:0.95}]}.
   * Cheap to compute; always on. Used by the codegen to name page objects
   * and test methods after detected flows (LoginPage.loginSmoke() instead
   * of InventoryHtmlPage.inventoryHtmlSmoke()).
   */
  pageLabels?: Record<string, PageLabel[]>;

  /** Total wall-clock duration of the crawl in milliseconds. */
  durationMs: number;

  /**
   * Link graph edges — one row per `<a href>` observed during the crawl.
   * Empty/undefined on single-page crawls. The target may be in-scope,
   * out-of-scope, duplicate of an already-visited URL, or failed; `status`
   * records which. Used by later phases to build the flow/intent graph.
   */
  edges?: CrawlEdge[];

  /**
   * Per-URL failures — pages we tried to visit but couldn't. Non-fatal to
   * the crawl (one bad page never kills the whole run); surfaced here so the
   * user can see what was missed.
   */
  failures?: CrawlFailure[];

  /**
   * Flow graph derived from `pages` + `edges` + `pageLabels`. Populated by
   * `@uaip/flow-graph` after labels run. Nodes are labelled visited pages,
   * edges are the "visited" subset of `CrawlEdge` (the only ones we know
   * actually navigate somewhere we have a PO for). Absent on single-page
   * crawls or when no pages carry labels — journey synthesis degrades to the
   * V1 single-page smoke in that case.
   */
  flowGraph?: FlowGraph;

  /**
   * Ranked journeys through the flow graph. Each entry is a plausible end-
   * to-end user scenario (e.g. login → inventory → cart → checkout →
   * order-confirm), scored by category coverage and whether it terminates
   * on a "goal" label. The codegen consumes this to emit one `@Test` method
   * per journey.
   */
  journeys?: Journey[];
}

/**
 * A link observed during crawling. One row per href found on `fromUrl`.
 * Duplicate `(fromUrl, toUrl)` pairs are deduped at emit time.
 */
export interface CrawlEdge {
  /** Normalised URL of the page where the link was discovered. */
  fromUrl: string;
  /** Normalised URL of the link target. */
  toUrl: string;
  /** What happened to `toUrl` during this crawl. */
  status: CrawlEdgeStatus;
  /** Optional: the anchor's visible text, for future intent-graph labelling. */
  linkText?: string;
}

export type CrawlEdgeStatus =
  /** Target was successfully visited and has a matching entry in pages[]. */
  | "visited"
  /** Target is in scope and was queued, but not visited (cap hit / still pending). */
  | "queued"
  /** Target was rejected by scope rules (different origin, excluded path, etc.). */
  | "out-of-scope"
  /** Target was already seen (same normalised URL as an earlier enqueue). */
  | "duplicate"
  /** Target was attempted but failed (timeout, navigation error, HTTP 5xx, etc.). */
  | "failed";

/**
 * Broad category a PageRule belongs to. Used in the dashboard to colour-
 * code rule badges and group rules for operators.
 */
export type PageCategory =
  | "auth"
  | "commerce"
  | "content"
  | "account"
  | "shell"
  | "errors";

/**
 * A single matched page-type label attached to a PageSnapshot by the
 * rule-based semantic layer. Multiple labels can fire on one page (e.g. a
 * checkout page that also contains a top-nav → ["checkout-payment",
 * "top-nav"]). The codegen uses the highest-confidence label in the
 * relevant category to name page objects and test methods.
 */
export interface PageLabel {
  /** Machine-readable snake/kebab-case label, e.g. "login", "checkout-payment". */
  label: string;
  /** Broad grouping. */
  category: PageCategory;
  /** Match strength, 0..1. */
  confidence: number;
  /** Stable id of the rule that fired — useful for debugging + dashboard tooltips. */
  ruleId: string;
}

/**
 * A node in the derived flow graph — one per visited page that carries at
 * least one non-shell label. Unlabelled pages (or shell-only ones) are
 * elided: they can't anchor a meaningful journey name, and keeping them in
 * the graph just inflates the path search space.
 */
export interface FlowNode {
  /** Normalised URL (matches `PageSnapshot.url`). Stable node id. */
  url: string;
  /** Page title at crawl time — useful for dashboard tooltips. */
  title: string;
  /** Primary label id (e.g. "login", "checkout-payment"). */
  label: string;
  /** Category of the primary label. */
  category: PageCategory;
  /** Confidence of the primary label match (0..1). */
  confidence: number;
}

/**
 * A directed edge in the flow graph. Only `CrawlEdge` entries with
 * `status === "visited"` become flow edges — those are the ones where we
 * have a matching PageSnapshot on the other end and can emit a real
 * "click the link, expect the next page" step.
 */
export interface FlowEdge {
  /** Source node URL. */
  fromUrl: string;
  /** Target node URL. */
  toUrl: string;
  /** The anchor text that produced this edge, if it was observed. */
  linkText?: string;
}

/**
 * Directed graph of navigation between labelled pages. Adjacency is kept
 * as a flat edge list (cheap, JSON-friendly) — consumers that want an
 * adjacency map re-index at read time.
 */
export interface FlowGraph {
  /** One entry per labelled visited page. */
  nodes: FlowNode[];
  /** Visited-edge subset of the crawl's link graph. */
  edges: FlowEdge[];
}

/**
 * A ranked path through the flow graph — the unit the codegen turns into a
 * single `@Test` method. Journeys are simple paths (no repeated node) so
 * they correspond to a natural "do A then B then C" scenario; cycles are
 * irrelevant for smoke-level tests and would explode the search space.
 */
export interface Journey {
  /** Ordered URLs the user traverses. `nodes[0]` is the start, last is terminal. */
  nodes: string[];
  /** The labels of each node, aligned 1:1 with `nodes`. Denormalised for codegen. */
  labels: string[];
  /** Scoring used to rank journeys. Higher = more useful. */
  score: number;
  /** Generated PascalCase name, e.g. "loginToOrderConfirmJourney". */
  name: string;
}

/**
 * A page we tried to visit but couldn't. Recorded for observability — the
 * BFS loop always moves on to the next URL rather than aborting.
 */
export interface CrawlFailure {
  /** Normalised URL we tried to visit. */
  url: string;
  /** Human-readable failure reason (Playwright error message / timeout / etc.). */
  reason: string;
  /** ISO timestamp of the failed attempt. */
  attemptedAt: string;
}
