/**
 * URL canonicalisation for crawl dedup.
 *
 * Two URLs that resolve to the "same page" should collapse to the same
 * normalised string so the frontier's visited set does the right thing.
 * Rules (kept intentionally small — surprises here cause crawl bugs):
 *
 *   - Only http/https survive. Everything else (mailto:, javascript:, tel:,
 *     blob:, data:, chrome:) returns null.
 *   - Relative refs are resolved against `base`.
 *   - Host is lowercased.
 *   - Default ports (80 for http, 443 for https) are stripped.
 *   - Fragment is dropped entirely — hash-only links are not distinct pages.
 *   - Query params are sorted alphabetically by key (stable, preserves values
 *     and preserves duplicate keys in key order).
 *   - Trailing slash is stripped except on the root path.
 *   - Percent-escapes are NOT decoded (avoids identity drift).
 *   - Username/password components are stripped (crawl context never cares).
 *
 * Returns the canonical string, or null if the URL cannot be normalised
 * (unparseable, unsupported scheme, etc.).
 */
export function normalizeUrl(raw: string, base?: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let u: URL;
  try {
    u = base ? new URL(trimmed, base) : new URL(trimmed);
  } catch {
    return null;
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") return null;

  u.hash = "";
  u.username = "";
  u.password = "";
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) {
    u.port = "";
  }

  // Sort query params. Preserve original ordering *within* a repeated key.
  if (u.search) {
    const params = Array.from(u.searchParams.entries());
    params.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    u.search = "";
    for (const [k, v] of params) u.searchParams.append(k, v);
  }

  let pathname = u.pathname;
  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.replace(/\/+$/, "");
  }
  u.pathname = pathname || "/";

  return u.toString();
}

/**
 * Extract the origin (scheme://host[:port]) from a URL. Used to seed scope
 * rules. Returns null if the URL can't be parsed.
 */
export function originOf(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Extract the pathname from a normalised URL. Convenience for scope checks.
 * Returns "/" for the root path; never returns null for a valid URL.
 */
export function pathnameOf(raw: string): string {
  try {
    return new URL(raw).pathname || "/";
  } catch {
    return "/";
  }
}
