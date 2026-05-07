/**
 * Live in-browser HUD for the crawl.
 *
 * What it does
 * ------------
 * Injects a fixed-position overlay panel into every page the crawler visits.
 * The panel shows, in real time:
 *   - the current URL (top header),
 *   - a running count of UI elements discovered + a histogram of their
 *     primary identification strategy (testid / id / role / generic),
 *   - a scrolling action log of every crawler decision (click, navigate,
 *     captured, skipped, …),
 *   - per-element badges: when the crawler interacts with or extracts an
 *     element, we briefly outline it on the page and label it with its
 *     `uaipId` + chosen primary strategy.
 *
 * How it's wired
 * --------------
 * The browser-side widget is a single string of HTML/CSS/JS, attached via
 * `BrowserContext.addInitScript` so it runs on every page load — including
 * after navigation, refreshes, and SPA route changes (we re-mount on a
 * MutationObserver if the page nukes the body).
 *
 * The crawler-side `HudController` is a thin Node-side facade. Each method
 * pushes an event into the browser via `page.evaluate(...)`, calling the
 * `window.__uaipHud.push(...)` global the init script defines. Calls are
 * fire-and-forget and swallow errors — the HUD must never wedge a crawl.
 *
 * Why init script (not page.addScriptTag)
 * ---------------------------------------
 * Init scripts run before any page script, so the HUD container is ready
 * before the site starts rendering. addScriptTag would race the site's own
 * load, and would have to be re-injected on every navigation by hand.
 *
 * Disabled mode
 * -------------
 * When `enabled: false` (the default for headless runs unless `--hud` is
 * passed) every HudController method becomes a no-op. The HUD is purely
 * additive — generated tests, snapshots, selectors are unchanged.
 */

import type { BrowserContext, Page } from "playwright";

/** Categorical primary strategy used by the HUD's histogram. Cheap to compute
 *  inline during extraction — distinct from the selector-engine's full
 *  scoring, but good enough for the live demo. */
export type HudStrategy = "testid" | "role" | "id" | "css" | "xpath" | "generic";

export interface HudOptions {
  /** When false, all controller methods are no-ops. */
  enabled: boolean;

  /**
   * Outline + badge highlights timeout (ms). Each `recordElement` call
   * paints an outline that auto-fades after this. Default 1200ms.
   */
  highlightMs?: number;

  /**
   * Cap for the action log scrollback in the page (most recent N entries).
   * Default 60.
   */
  logScrollback?: number;
}

/**
 * Node-side facade. Construct once per crawl; call `attach` with the
 * Playwright `BrowserContext` *before* any `page.goto`, then sprinkle
 * `setUrl`/`recordElement`/`action` calls through the crawl.
 */
export class HudController {
  private readonly enabled: boolean;
  private readonly highlightMs: number;
  private readonly logScrollback: number;
  private context: BrowserContext | null = null;
  private currentPage: Page | null = null;

  constructor(opts: HudOptions) {
    this.enabled = opts.enabled;
    this.highlightMs = opts.highlightMs ?? 1200;
    this.logScrollback = opts.logScrollback ?? 60;
  }

  /**
   * Install the in-page widget on every page in the context. Must be called
   * before the first navigation; safe to call once.
   */
  async attach(context: BrowserContext): Promise<void> {
    if (!this.enabled) return;
    this.context = context;
    const script = renderInitScript({
      highlightMs: this.highlightMs,
      logScrollback: this.logScrollback,
    });
    await context.addInitScript({ content: script });
  }

  /** Bind the active page so subsequent `recordElement`/`action` events
   *  target it. The crawler calls this once per visit. */
  bindPage(page: Page): void {
    if (!this.enabled) return;
    this.currentPage = page;
  }

  /** Update the HUD header to a new URL. Called after navigation lands. */
  async setUrl(url: string): Promise<void> {
    if (!this.enabled || !this.currentPage) return;
    await this.push({ kind: "url", url });
  }

  /**
   * Tell the HUD a new element was discovered. Bumps the count + histogram
   * and (best-effort) outlines + labels the element on the page using its
   * xpath, which is the most stable selector at this point in the pipeline.
   */
  async recordElement(args: {
    uaipId: string;
    strategy: HudStrategy;
    xpath: string;
    label: string;
  }): Promise<void> {
    if (!this.enabled || !this.currentPage) return;
    await this.push({ kind: "element", ...args });
  }

  /** Append an entry to the scrolling action log. Free-form short string. */
  async action(text: string): Promise<void> {
    if (!this.enabled || !this.currentPage) return;
    await this.push({ kind: "action", text, ts: Date.now() });
  }

  /** Reset element count + histogram (e.g., on each new page). */
  async reset(): Promise<void> {
    if (!this.enabled || !this.currentPage) return;
    await this.push({ kind: "reset" });
  }

  // ───────── internals ─────────

  /** Fire-and-forget push. Errors (page closed, navigation in flight) are
   *  swallowed so HUD glitches never abort a crawl. */
  private async push(event: HudEvent): Promise<void> {
    const page = this.currentPage;
    if (!page) return;
    try {
      await page.evaluate(
        (e: HudEvent) => {
          const w = window as unknown as { __uaipHud?: { push: (e: HudEvent) => void } };
          w.__uaipHud?.push(e);
        },
        event,
      );
    } catch {
      // Ignore: page may be navigating, closed, or CSP-restricted.
    }
  }

  /** Convenience: HudController that does nothing. Saves callers from
   *  threading optional types through every signature. */
  static noop(): HudController {
    return new HudController({ enabled: false });
  }
}

// ───────────────────── browser-side script ─────────────────────

/**
 * Produce the JS that runs inside every page. Kept as a single string so we
 * can ship it via `addInitScript` — Playwright doesn't require a real file.
 *
 * The script:
 *   - exposes `window.__uaipHud.push(event)` for the controller to call,
 *   - mounts a Shadow DOM root so site CSS can't bleed into the HUD (and
 *     vice-versa),
 *   - re-mounts on MutationObserver if the host removes our root (some SPAs
 *     replace document.body wholesale on navigation),
 *   - keeps the histogram/log/element-counter as plain in-memory state so
 *     a hot-reload of the script (rare) starts clean.
 */
interface HudEvent {
  kind: "url" | "element" | "action" | "reset";
  url?: string;
  uaipId?: string;
  strategy?: HudStrategy;
  xpath?: string;
  label?: string;
  text?: string;
  ts?: number;
}

interface InitScriptOpts {
  highlightMs: number;
  logScrollback: number;
}

function renderInitScript(opts: InitScriptOpts): string {
  // The body of the IIFE is plain JS; we string-interpolate the two numeric
  // config values. Keep it self-contained — no imports, no template tags —
  // so it runs in any browser context Playwright spawns.
  return `(() => {
  if (window.__uaipHud) return;
  const HIGHLIGHT_MS = ${opts.highlightMs};
  const LOG_MAX = ${opts.logScrollback};

  const state = {
    url: location.href,
    count: 0,
    histo: { testid: 0, role: 0, id: 0, css: 0, xpath: 0, generic: 0 },
    log: [],
  };

  function ensureRoot() {
    let host = document.getElementById("__uaip_hud_host__");
    if (host && host.shadowRoot) return host.shadowRoot;
    if (host) host.remove();
    host = document.createElement("div");
    host.id = "__uaip_hud_host__";
    host.style.cssText = "all: initial; position: fixed; right: 12px; bottom: 12px; z-index: 2147483647;";
    (document.body || document.documentElement).appendChild(host);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = baseTemplate();
    return root;
  }

  function baseTemplate() {
    return \`
      <style>
        :host, * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        .hud {
          width: 320px; max-height: 60vh; overflow: hidden;
          background: rgba(24,26,31,0.94); color: #dcdfe4;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 10px; box-shadow: 0 12px 32px rgba(0,0,0,0.45);
          display: flex; flex-direction: column;
          backdrop-filter: blur(6px);
        }
        .header { padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.06); display: flex; align-items: center; gap: 8px; }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: #98c379; box-shadow: 0 0 8px #98c379aa; }
        .title { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #c678dd; font-weight: 600; }
        .url { padding: 6px 12px; font-size: 11px; color: #82c8ff; word-break: break-all; line-height: 1.35; border-bottom: 1px solid rgba(255,255,255,0.04); }
        .stats { display: flex; align-items: baseline; gap: 8px; padding: 8px 12px; }
        .count { font-size: 22px; font-weight: 700; color: #dcdfe4; }
        .countLabel { font-size: 11px; color: #888a93; }
        .histo { display: flex; gap: 4px; padding: 0 12px 8px; }
        .bar { flex: 1; min-width: 0; position: relative; }
        .bar .fill { height: 18px; border-radius: 3px; background: rgba(255,255,255,0.08); position: relative; overflow: hidden; }
        .bar .fill > div { position: absolute; bottom: 0; left: 0; right: 0; transition: height 120ms ease; }
        .bar .lbl { font-size: 9px; color: #888a93; text-align: center; margin-top: 2px; letter-spacing: 0.04em; text-transform: uppercase; }
        .bar .val { font-size: 9px; color: #dcdfe4; text-align: center; margin-top: 1px; }
        .testid .fill > div { background: #98c379; }
        .role   .fill > div { background: #61afef; }
        .id     .fill > div { background: #c678dd; }
        .css    .fill > div { background: #e5c07b; }
        .xpath  .fill > div { background: #56b6c2; }
        .generic .fill > div { background: #888a93; }
        .log { font-size: 11px; line-height: 1.4; padding: 6px 12px 10px; overflow-y: auto; max-height: 24vh; border-top: 1px solid rgba(255,255,255,0.04); }
        .log .row { display: flex; gap: 6px; opacity: 0.92; }
        .log .ts { color: #888a93; font-variant-numeric: tabular-nums; }
        .log .msg { color: #dcdfe4; }
        .footer { font-size: 10px; color: #888a93; padding: 6px 12px; border-top: 1px solid rgba(255,255,255,0.04); display: flex; justify-content: space-between; }
      </style>
      <div class="hud">
        <div class="header"><span class="dot"></span><span class="title">UAIP · Live Crawl</span></div>
        <div class="url" data-url></div>
        <div class="stats"><span class="count" data-count>0</span><span class="countLabel">elements discovered</span></div>
        <div class="histo">
          \${["testid","role","id","css","xpath","generic"].map(s =>
            \`<div class="bar \${s}"><div class="fill"><div data-fill="\${s}"></div></div><div class="lbl">\${s}</div><div class="val" data-val="\${s}">0</div></div>\`
          ).join("")}
        </div>
        <div class="log" data-log></div>
        <div class="footer"><span>uaipId outlined → fades</span><span>shadow DOM</span></div>
      </div>
    \`;
  }

  function render() {
    const root = ensureRoot();
    const u = root.querySelector("[data-url]"); if (u) u.textContent = state.url;
    const c = root.querySelector("[data-count]"); if (c) c.textContent = String(state.count);
    const max = Math.max(1, ...Object.values(state.histo));
    for (const k of Object.keys(state.histo)) {
      const fill = root.querySelector('[data-fill="' + k + '"]');
      const val = root.querySelector('[data-val="' + k + '"]');
      const v = state.histo[k];
      if (fill) fill.style.height = ((v / max) * 100) + "%";
      if (val) val.textContent = String(v);
    }
    const log = root.querySelector("[data-log]");
    if (log) {
      log.innerHTML = state.log.slice(-LOG_MAX).map(r =>
        '<div class="row"><span class="ts">' + r.ts + '</span><span class="msg">' + escapeHtml(r.text) + '</span></div>'
      ).join("");
      log.scrollTop = log.scrollHeight;
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[ch]);
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, "0");
    return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }

  function highlightByXpath(xpath, label) {
    try {
      const r = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      const el = r.singleNodeValue;
      if (!el || !(el instanceof Element)) return;
      const prev = el.style.outline;
      const prevOffset = el.style.outlineOffset;
      el.style.outline = "2px solid #c678dd";
      el.style.outlineOffset = "2px";
      // Floating badge anchored at the element's top-left.
      const rect = el.getBoundingClientRect();
      const badge = document.createElement("div");
      badge.textContent = label;
      badge.style.cssText = "position:fixed;z-index:2147483646;background:#c678dd;color:#0b0c10;font:10px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-weight:600;padding:1px 5px;border-radius:3px;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,0.4);";
      badge.style.left = Math.max(0, rect.left) + "px";
      badge.style.top = Math.max(0, rect.top - 16) + "px";
      document.body.appendChild(badge);
      setTimeout(() => {
        try { el.style.outline = prev; el.style.outlineOffset = prevOffset; } catch (_e) {}
        badge.remove();
      }, HIGHLIGHT_MS);
    } catch (_e) { /* xpath might be invalid in this DOM — ignore. */ }
  }

  window.__uaipHud = {
    push(e) {
      try {
        if (e.kind === "url") {
          state.url = e.url;
          state.log.push({ ts: fmtTime(Date.now()), text: "→ navigate " + e.url });
        } else if (e.kind === "element") {
          state.count++;
          if (state.histo[e.strategy] != null) state.histo[e.strategy]++;
          if (e.xpath) highlightByXpath(e.xpath, e.label || e.uaipId);
        } else if (e.kind === "action") {
          state.log.push({ ts: fmtTime(e.ts || Date.now()), text: e.text });
        } else if (e.kind === "reset") {
          state.count = 0;
          for (const k of Object.keys(state.histo)) state.histo[k] = 0;
        }
        render();
      } catch (_e) { /* never let HUD errors propagate. */ }
    },
  };

  // Mount once the body exists. Some pages have a noscript-only body until
  // the SPA boots; observe and re-mount as needed.
  const mount = () => { try { ensureRoot(); render(); } catch (_e) {} };
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount, { once: true });
  new MutationObserver(() => {
    if (!document.getElementById("__uaip_hud_host__")) mount();
  }).observe(document.documentElement, { childList: true, subtree: true });
})();`;
}
