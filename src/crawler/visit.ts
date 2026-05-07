/**
 * Per-page worker — visits one URL on an already-open Playwright `Page`,
 * snapshots its elements + ARIA tree, and harvests its outbound links.
 *
 * Everything here is wrapped so that a single bad page NEVER throws out of
 * `visitPage`. The BFS loop in `crawl.ts` depends on that contract: we record
 * a failure and move on, rather than aborting the whole crawl.
 */

import type { Page } from "playwright";
import type { PageSnapshot, UiElement } from "../types/index.js";

import { extractElements } from "./extract.js";
import { HudController, type HudStrategy } from "./hud.js";
import { extractLinks, type DiscoveredLink } from "./links.js";

export interface VisitOptions {
  /** Viewport recorded into the PageSnapshot. */
  viewport: { width: number; height: number };
  /** Max ms to wait for initial load before extracting. */
  navigationTimeoutMs: number;
  /** Max ms to wait for networkidle after navigation. */
  idleMs: number;
  /** Hard wall-clock cap on the whole visit (goto + extract + links). */
  perPageTimeoutMs: number;
  /**
   * Optional HUD controller. When provided, visit pushes navigation, element
   * discovery, and per-action events to the in-page overlay. Use
   * `HudController.noop()` to disable cleanly.
   */
  hud?: HudController;
}

export interface VisitResult {
  /** Set when the page was visited successfully. */
  snapshot?: PageSnapshot;
  /** Links discovered on this page. Present only when snapshot is set. */
  links?: DiscoveredLink[];
  /** Set when the visit failed — human-readable reason. */
  error?: string;
}

/**
 * Visit a single URL. Never throws.
 */
export async function visitPage(page: Page, url: string, opts: VisitOptions): Promise<VisitResult> {
  try {
    return await withHardTimeout(doVisit(page, url, opts), opts.perPageTimeoutMs, url);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function doVisit(page: Page, url: string, opts: VisitOptions): Promise<VisitResult> {
  // HUD: bind the active page early so any error logging can flow into the
  // overlay even if navigation itself fails. `bindPage`/`reset`/`setUrl` are
  // no-ops when the controller is in disabled mode.
  if (opts.hud) {
    opts.hud.bindPage(page);
    await opts.hud.reset();
    await opts.hud.action(`visit ${url}`);
  }

  await page.goto(url, {
    timeout: opts.navigationTimeoutMs,
    waitUntil: "domcontentloaded",
  });

  // Best-effort networkidle wait. A page with long-lived connections (SSE,
  // websockets) never settles; don't let that abort the visit.
  await page
    .waitForLoadState("networkidle", { timeout: opts.idleMs })
    .catch(() => {
      // Intentional: proceed with extraction even without networkidle.
    });

  const snapshot = await snapshotPage(page, opts.viewport);

  // HUD: announce landed URL + per-element events. Done after extraction so
  // we don't race the page's own scripts mutating the DOM during initial
  // paint. Errors inside HUD calls are swallowed by the controller.
  if (opts.hud) {
    await opts.hud.setUrl(snapshot.url);
    for (const el of snapshot.elements) {
      const strategy = categoriseStrategy(el);
      const label = el.accessibleName?.slice(0, 36) ?? el.uaipId;
      await opts.hud.recordElement({
        uaipId: el.uaipId,
        strategy,
        xpath: el.xpath,
        label: `${el.uaipId} · ${strategy}`,
      });
      await opts.hud.action(`+ ${el.uaipId} (${strategy}) ${label}`);
    }
  }

  const links = await extractLinks(page, snapshot.url).catch(() => [] as DiscoveredLink[]);
  if (opts.hud) await opts.hud.action(`links ${links.length}`);
  return { snapshot, links };
}

/**
 * Cheap categorical bucket used by the HUD histogram. NOT the same as the
 * selector-engine's full primary scoring — that runs after the crawl. This
 * one is fast enough to call inline for every element on every page.
 */
function categoriseStrategy(el: UiElement): HudStrategy {
  const data = el.attrs.dataAttributes ?? {};
  if (
    data["data-test"] ||
    data["data-testid"] ||
    data["data-qa"] ||
    data["data-cy"]
  ) {
    return "testid";
  }
  if (el.attrs.id) return "id";
  if (el.role && el.accessibleName) return "role";
  if (el.attrs.className) return "css";
  return "generic";
}

async function snapshotPage(
  page: Page,
  viewport: { width: number; height: number },
): Promise<PageSnapshot> {
  const url = page.url();
  const title = await page.title();
  const elements: UiElement[] = await extractElements(page);

  // ARIA snapshot is best-effort — shape is Playwright-version-specific.
  const ariaSnapshot = await page
    .locator("body")
    .ariaSnapshot({ timeout: 2000 })
    .catch(() => undefined);

  return {
    url,
    title,
    viewport,
    crawledAt: new Date().toISOString(),
    elements,
    ...(ariaSnapshot !== undefined ? { ariaSnapshot } : {}),
  };
}

/**
 * Race `p` against a timer. If the timer wins, throw a clear error that
 * names the URL we were trying to visit (so failures in the crawl log are
 * actionable). If `p` wins, return its value.
 */
function withHardTimeout<T>(p: Promise<T>, ms: number, url: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`visit timed out after ${ms}ms: ${url}`)),
      ms,
    );
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
