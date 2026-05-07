/**
 * Link extraction — harvests `<a href>` candidates from a loaded page so the
 * BFS loop knows where to go next.
 *
 * Phase 0 scope: only `<a href>`. Buttons with onClick handlers and SPA
 * router links (`<Link to>` / `history.pushState`) are deferred; crawling a
 * React Router app today will look like one page.
 *
 * The browser-side half just harvests raw hrefs + link text (cheap). The
 * Node-side half normalises and filters — keeping the cross-boundary surface
 * small (strings go over the RPC, not URL objects).
 */

import type { Page } from "playwright";

import { normalizeUrl } from "./normalize.js";

export interface RawLink {
  /** Browser-resolved absolute href (before our normalisation). */
  href: string;
  /** Visible anchor text, trimmed and truncated to 200 chars. */
  text?: string;
}

export interface DiscoveredLink {
  /** Normalised URL (stable dedup key). */
  url: string;
  /** Original pre-normalisation href, for debugging. */
  rawHref: string;
  /** Visible anchor text, if any. */
  text?: string;
}

/**
 * Returns one entry per `<a href>` on the page. Links that normalise to the
 * same URL as the current page (i.e. pure fragment / self links) are filtered
 * out so they don't pollute the edge graph.
 *
 * The returned list may contain duplicates (same URL linked multiple times on
 * one page). The frontier handles that dedup; we don't drop them here because
 * the caller may want the count for analytics.
 */
export async function extractLinks(page: Page, currentUrl: string): Promise<DiscoveredLink[]> {
  const raw: RawLink[] = await page.evaluate(() => {
    const out: RawLink[] = [];
    const anchors = document.querySelectorAll("a[href]");
    for (const a of Array.from(anchors)) {
      const href = (a as HTMLAnchorElement).href;
      if (!href) continue;
      const text = (a.textContent || "").trim().slice(0, 200) || undefined;
      out.push({ href, text });
    }
    return out;
  });

  const current = normalizeUrl(currentUrl);
  const results: DiscoveredLink[] = [];
  for (const link of raw) {
    const normalised = normalizeUrl(link.href, currentUrl);
    if (!normalised) continue;
    // Drop pure-fragment self-links.
    if (current && normalised === current) continue;
    const result: DiscoveredLink = { url: normalised, rawHref: link.href };
    if (link.text) result.text = link.text;
    results.push(result);
  }
  return results;
}
