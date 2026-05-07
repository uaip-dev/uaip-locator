/**
 * BFS crawler built on Playwright.
 *
 * Launches Chromium once, walks the frontier breadth-first, and collects one
 * `PageSnapshot` per successfully-visited URL. Links discovered on each page
 * are normalised, scope-checked, and enqueued; failures are recorded but
 * never abort the whole crawl.
 *
 * Public API:
 *
 *   crawlSite(opts)  — the multi-page entry point. Primary API.
 *   crawlPage(opts)  — back-compat single-page shim. Delegates to crawlSite
 *                      with `maxPages: 1, maxDepth: 0`. Kept so existing
 *                      smoke fixtures and callers don't need to change.
 */

import { chromium, type Browser, type Page } from "playwright";
import type {
  CrawlEdge,
  CrawlEdgeStatus,
  CrawlFailure,
  CrawlResult,
  PageSnapshot,
} from "../types/index.js";

import { Frontier } from "./frontier.js";
import { HudController } from "./hud.js";
import type { DiscoveredLink } from "./links.js";
import { normalizeUrl, originOf } from "./normalize.js";
import { buildScopeRules, inScope, type ScopeRules } from "./scope.js";
import { visitPage } from "./visit.js";

// ───────────────────────── Defaults ─────────────────────────

const DEFAULT_VIEWPORT = { width: 1280, height: 800 };
const DEFAULT_NAV_TIMEOUT = 30_000;
const DEFAULT_IDLE_MS = 500;
const DEFAULT_PER_PAGE_TIMEOUT = 60_000;
const DEFAULT_MAX_PAGES = 25;
const CASCADE_FAILURE_LIMIT = 5;

// ───────────────────────── Public options ─────────────────────────

/** Single-page options (back-compat). New code should prefer CrawlSiteOptions. */
export interface CrawlOptions {
  url: string;
  viewport?: { width: number; height: number };
  userAgent?: string;
  headed?: boolean;
  navigationTimeoutMs?: number;
  idleMs?: number;
}

export interface CrawlSiteOptions {
  /** Start URL — seed of the BFS. */
  url: string;

  /** Viewport width/height. Defaults to 1280x800. */
  viewport?: { width: number; height: number };

  /** Custom user-agent. */
  userAgent?: string;

  /** Run browser with UI. Default = headless. */
  headed?: boolean;

  /** Max ms for each page.goto. Default 30s. */
  navigationTimeoutMs?: number;

  /** Max ms to wait for networkidle after navigation. Default 500ms. */
  idleMs?: number;

  /**
   * Hard wall-clock cap on each visit (navigation + extraction + links).
   * Protects against pages whose networkidle never settles AND whose extract
   * hangs. Default 60s.
   */
  perPageTimeoutMs?: number;

  /** Hard cap on number of pages visited. Default 25. */
  maxPages?: number;

  /**
   * Path to a Playwright `storageState` JSON file (produced by `uaip auth
   * record` or `uaip auth login`). When provided, the browser context is
   * seeded with its cookies + localStorage, so the crawl runs as the
   * authenticated user. If the file is missing or malformed the crawl
   * throws before any navigation so the user gets an actionable error.
   */
  storageStatePath?: string;

  /**
   * Max BFS depth from the start URL. Start page = depth 0. Undefined =
   * unbounded (bounded in practice by maxPages).
   */
  maxDepth?: number;

  /**
   * Scope rules. Defaults: `sameOrigin: true`, no path prefix, no includes,
   * no excludes. All values optional.
   */
  scope?: {
    sameOrigin?: boolean;
    pathPrefix?: string;
    /** Regex sources (strings). Invalid patterns throw before the crawl starts. */
    include?: string[];
    /** Regex sources (strings). Invalid patterns throw before the crawl starts. */
    exclude?: string[];
  };

  /**
   * Optional progress hook. Fires once per successfully-visited page, after
   * the snapshot is captured and before the next URL is dequeued.
   * Visited count passed is 1-based (first page = 1).
   */
  onPageVisited?: (snapshot: PageSnapshot, depth: number, visited: number) => void;

  /**
   * Optional failure hook. Fires once per URL that couldn't be visited.
   * Purely informational — the BFS loop always records + continues.
   */
  onPageFailed?: (url: string, reason: string) => void;

  /**
   * When true, inject the live in-browser HUD overlay on every page (see
   * `hud.ts`). Most useful with `headed: true` so you can actually watch
   * the crawl in real time. The HUD never alters extracted snapshots,
   * selectors, or generated tests — purely additive observability.
   */
  hud?: boolean;
}

// ───────────────────────── Public API ─────────────────────────

export async function crawlSite(opts: CrawlSiteOptions): Promise<CrawlResult> {
  const started = Date.now();
  const viewport = opts.viewport ?? DEFAULT_VIEWPORT;
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  const maxDepth = opts.maxDepth ?? Number.POSITIVE_INFINITY;

  const startNormalised = normalizeUrl(opts.url);
  if (!startNormalised) {
    throw new Error(`Invalid start URL: ${opts.url}`);
  }
  const origin = originOf(startNormalised);
  if (!origin) {
    throw new Error(`Could not derive origin from start URL: ${opts.url}`);
  }

  const scope: ScopeRules = buildScopeRules({
    origin,
    sameOrigin: opts.scope?.sameOrigin,
    ...(opts.scope?.pathPrefix !== undefined ? { pathPrefix: opts.scope.pathPrefix } : {}),
    ...(opts.scope?.include !== undefined ? { include: opts.scope.include } : {}),
    ...(opts.scope?.exclude !== undefined ? { exclude: opts.scope.exclude } : {}),
  });

  const frontier = new Frontier();
  frontier.enqueue({ url: startNormalised, depth: 0 });

  const pagesOut: PageSnapshot[] = [];
  const edges: CrawlEdge[] = [];
  let consecutiveFailures = 0;

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: !opts.headed });
    const context = await browser.newContext({
      viewport,
      userAgent: opts.userAgent,
      // Playwright's `storageState` accepts either the object or a file path;
      // we pass the path so Playwright does its own schema validation on
      // load and errors out with a clear message if the file is malformed.
      ...(opts.storageStatePath !== undefined
        ? { storageState: opts.storageStatePath }
        : {}),
    });

    // Attach the HUD before opening the first page so the init script is
    // available on the very first navigation. `noop()` mode skips injection
    // entirely so disabled runs pay zero overhead.
    const hud = opts.hud ? new HudController({ enabled: true }) : HudController.noop();
    await hud.attach(context);

    const page: Page = await context.newPage();

    while (frontier.pendingCount() > 0 && pagesOut.length < maxPages) {
      const item = frontier.dequeue();
      if (!item) break;
      if (item.depth > maxDepth) continue;

      const result = await visitPage(page, item.url, {
        viewport,
        navigationTimeoutMs: opts.navigationTimeoutMs ?? DEFAULT_NAV_TIMEOUT,
        idleMs: opts.idleMs ?? DEFAULT_IDLE_MS,
        perPageTimeoutMs: opts.perPageTimeoutMs ?? DEFAULT_PER_PAGE_TIMEOUT,
        hud,
      });

      if (result.error || !result.snapshot) {
        const reason = result.error ?? "unknown visit failure";
        frontier.markFailed(item.url, reason);
        opts.onPageFailed?.(item.url, reason);
        consecutiveFailures++;
        if (consecutiveFailures >= CASCADE_FAILURE_LIMIT) {
          throw new Error(
            `Aborting crawl: ${consecutiveFailures} consecutive failures (last: ${reason})`,
          );
        }
        continue;
      }
      consecutiveFailures = 0;

      // Record snapshot. Handle post-redirect drift: the landed URL may not
      // equal the requested URL. Dedup on the landed URL so we don't crawl
      // aliases twice.
      const landed = normalizeUrl(result.snapshot.url) ?? item.url;
      if (landed !== item.url && frontier.hasSeen(landed)) {
        edges.push({ fromUrl: item.url, toUrl: landed, status: "duplicate" });
        continue;
      }
      if (landed !== item.url) {
        // Mark the landed URL as visited so future enqueues are deduped.
        frontier.enqueue({ url: landed, depth: item.depth, ...(item.parentUrl !== undefined ? { parentUrl: item.parentUrl } : {}) });
      }
      pagesOut.push(result.snapshot);
      opts.onPageVisited?.(result.snapshot, item.depth, pagesOut.length);

      // Promote any previously-queued incoming edges whose target is this
      // page to `status: "visited"`. Without this, `edges[]` only ever holds
      // "queued" / "duplicate" / "out-of-scope" / "failed" statuses — and
      // downstream consumers like @uaip/flow-graph (which filters on
      // `status === "visited"`) would produce an empty graph. An edge can
      // also be present under `item.url` if this page was reached via a
      // redirect, so upgrade both the requested and the landed URL.
      for (const edge of edges) {
        if (edge.status !== "queued") continue;
        if (edge.toUrl === landed || edge.toUrl === item.url) {
          edge.status = "visited";
        }
      }

      // Record edges + enqueue in-scope links.
      const links = result.links ?? [];
      if (pagesOut.length < maxPages && item.depth < maxDepth) {
        for (const link of links) {
          const status = classifyLink(link, frontier, scope);
          edges.push({
            fromUrl: landed,
            toUrl: link.url,
            status,
            ...(link.text !== undefined ? { linkText: link.text } : {}),
          });
          if (status === "queued") {
            frontier.enqueue({ url: link.url, depth: item.depth + 1, parentUrl: landed });
          }
        }
      } else {
        // We've hit the cap on this visit — still record edges, but mark
        // would-be-enqueued links as `queued` without actually enqueueing,
        // since further crawling is capped.
        for (const link of links) {
          const status = classifyLink(link, frontier, scope);
          edges.push({
            fromUrl: landed,
            toUrl: link.url,
            status: status === "queued" ? "queued" : status,
            ...(link.text !== undefined ? { linkText: link.text } : {}),
          });
        }
      }
    }

    const failuresList = frontier.getFailures();
    const failures: CrawlFailure[] = failuresList.map((f) => ({
      url: f.url,
      reason: f.reason,
      attemptedAt: f.attemptedAt,
    }));

    const result: CrawlResult = {
      schemaVersion: 1,
      target: {
        url: opts.url,
        viewport,
        ...(opts.userAgent !== undefined ? { userAgent: opts.userAgent } : {}),
      },
      pages: pagesOut,
      durationMs: Date.now() - started,
      ...(edges.length > 0 ? { edges } : {}),
      ...(failures.length > 0 ? { failures } : {}),
    };

    return result;
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Back-compat single-page wrapper. Delegates to `crawlSite` with the tightest
 * possible scope (depth 0, maxPages 1). Existing callers (smoke harness,
 * older CLI paths) keep working unchanged.
 */
export async function crawlPage(opts: CrawlOptions): Promise<CrawlResult> {
  return crawlSite({
    url: opts.url,
    ...(opts.viewport !== undefined ? { viewport: opts.viewport } : {}),
    ...(opts.userAgent !== undefined ? { userAgent: opts.userAgent } : {}),
    ...(opts.headed !== undefined ? { headed: opts.headed } : {}),
    ...(opts.navigationTimeoutMs !== undefined
      ? { navigationTimeoutMs: opts.navigationTimeoutMs }
      : {}),
    ...(opts.idleMs !== undefined ? { idleMs: opts.idleMs } : {}),
    maxPages: 1,
    maxDepth: 0,
  });
}

// ───────────────────────── Internals ─────────────────────────

function classifyLink(
  link: DiscoveredLink,
  frontier: Frontier,
  scope: ScopeRules,
): CrawlEdgeStatus {
  if (!inScope(link.url, scope)) return "out-of-scope";
  if (frontier.hasSeen(link.url)) return "duplicate";
  return "queued";
}
