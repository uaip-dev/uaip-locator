/**
 * Test action model — the intermediate representation consumed by codegen.
 *
 * Every framework emitter (Selenium, Playwright, Cypress, UiPath) takes a
 * list of `TestAction` and a map of `SelectorBundle` and produces code.
 * Keeping actions framework-neutral is what lets us add new emitters without
 * touching the crawler or selector engine.
 */

import type { PageLabel } from "./crawl.js";

export type ActionKind =
  | "navigate"
  | "click"
  | "fill"
  | "press" // keyboard key
  | "check"
  | "uncheck"
  | "selectOption"
  | "hover"
  | "waitFor" // wait for element to be visible/attached
  | "expectVisible"
  | "expectText"
  | "expectUrl"
  | "expectUrlChanged"
  | "screenshot";

export interface BaseAction {
  /** Strategy-neutral kind of action. */
  kind: ActionKind;

  /**
   * Optional reference to an element in the crawl's selector bundles
   * (`SelectorBundle.uaipId`). Not every action targets an element —
   * `navigate`, `expectUrl`, `screenshot` don't.
   */
  targetUaipId?: string;

  /**
   * Optional human-readable step description. Emitted as a code comment
   * above the action so the generated file is readable.
   */
  comment?: string;
}

export interface NavigateAction extends BaseAction {
  kind: "navigate";
  url: string;
}

export interface ClickAction extends BaseAction {
  kind: "click";
  targetUaipId: string;
}

export interface FillAction extends BaseAction {
  kind: "fill";
  targetUaipId: string;
  value: string;
}

export interface PressAction extends BaseAction {
  kind: "press";
  targetUaipId: string;
  key: string;
}

export interface CheckAction extends BaseAction {
  kind: "check" | "uncheck";
  targetUaipId: string;
}

export interface SelectOptionAction extends BaseAction {
  kind: "selectOption";
  targetUaipId: string;
  value: string;
}

export interface HoverAction extends BaseAction {
  kind: "hover";
  targetUaipId: string;
}

export interface WaitForAction extends BaseAction {
  kind: "waitFor";
  targetUaipId: string;
  timeoutMs?: number;
}

export interface ExpectVisibleAction extends BaseAction {
  kind: "expectVisible";
  targetUaipId: string;
}

export interface ExpectTextAction extends BaseAction {
  kind: "expectText";
  targetUaipId: string;
  expected: string;
}

export interface ExpectUrlAction extends BaseAction {
  kind: "expectUrl";
  pattern: string;
}

/**
 * Assert that the browser URL has changed away from `fromUrl`.
 *
 * Use this for "did the click actually do anything" smoke checks — it
 * survives any post-nav URL (dashboard, inventory, /home, etc.) without
 * over-fitting to a specific path. The crawler can't know the target URL
 * a priori, so an equality-negated check is a better default than
 * `expectUrl` with pattern ".*".
 */
export interface ExpectUrlChangedAction extends BaseAction {
  kind: "expectUrlChanged";
  fromUrl: string;
}

export interface ScreenshotAction extends BaseAction {
  kind: "screenshot";
  name: string;
}

export type TestAction =
  | NavigateAction
  | ClickAction
  | FillAction
  | PressAction
  | CheckAction
  | SelectOptionAction
  | HoverAction
  | WaitForAction
  | ExpectVisibleAction
  | ExpectTextAction
  | ExpectUrlAction
  | ExpectUrlChangedAction
  | ScreenshotAction;

/** A named sequence of actions — becomes a single `@Test` method in the emitted code. */
export interface TestScenario {
  /** PascalCase name — used as Java method / test file name. */
  name: string;

  /** One-line description emitted as a comment/doc block. */
  description?: string;

  /** Ordered actions. */
  actions: TestAction[];
}

/**
 * A single crawled page, as consumed by codegen.
 *
 * In multi-page mode, the emitter renders one Page Object per `CodegenPage`
 * entry, using `name` as the class name and `elementUaipIds` to decide which
 * selector bundles belong on that page. If `CodegenInput.pages` is omitted,
 * emitters fall back to single-PO mode (legacy behaviour).
 */
export interface CodegenPage {
  /** PascalCase Page Object class name (e.g., "LoginPage", "InventoryPage"). */
  name: string;

  /** Absolute URL of this page, as returned by the crawler. */
  url: string;

  /**
   * uaipIds of elements that belong to this page. Emitters use this to
   * partition selector bundles across pages — so each PO only exposes its
   * own elements.
   */
  elementUaipIds: string[];

  /**
   * Plan §21 Phase 4 tag system v2 — per-page tags computed by
   * `tagsForPage(label)` in `@uaip/coverage`. Emitters render these as
   * framework-specific test categorisation annotations (`@Tag("smoke")`,
   * `@pytest.mark.smoke`, `test('…', { tag: ['@smoke'] }, …)`, etc.).
   *
   * Always sorted with "smoke" pinned first. Empty / omitted means no
   * tag annotations are emitted (legacy behaviour).
   */
  tags?: string[];
}

/** What codegen consumes. */
export interface CodegenInput {
  /** PascalCase base name for generated files. */
  baseName: string;

  /** Starting URL for the scenarios (used in Page Object / setup). */
  baseUrl: string;

  /** One or more scenarios — each becomes a `@Test` method. */
  scenarios: TestScenario[];

  /**
   * Optional semantic labels keyed by uaipId. When present, emitters use these
   * camelCase intent names in place of the heuristic `fieldNameFor()` output —
   * so a `data-test='login-button'` becomes `primaryLoginButton` rather than
   * `loginButton`. Falls back to heuristics for any uaipId not in the map.
   */
  semanticLabels?: Record<string, string>;

  /**
   * Optional list of crawled pages. When present, emitters produce one Page
   * Object class per entry — routing locators/actions to the PO that owns
   * each element. When omitted, emitters produce a single `<baseName>Page`
   * (legacy single-page mode), preserving backward compatibility.
   */
  pages?: CodegenPage[];

  /**
   * Optional rule-based page labels per URL. When present, emitters may use
   * the highest-confidence non-shell label to name Page Objects and test
   * methods after detected flows (e.g. LoginPage rather than
   * InventoryHtmlPage). Falls back to the URL-derived heuristic for any URL
   * without a match. Sourced from `CrawlResult.pageLabels`.
   */
  pageLabels?: Record<string, PageLabel[]>;

  /**
   * Optional authentication state (cookies + localStorage) to apply before
   * any scenario navigates. When present, emitters generate an `applyAuth`
   * helper invoked from `@BeforeAll` so generated tests run as a signed-in
   * user — matching the session that was active during the crawl.
   *
   * Sourced from a Playwright storageState file (what `uaip auth` produces).
   */
  auth?: AuthState;
}

/**
 * Cookie + localStorage payload for `CodegenInput.auth`. Mirrors a subset of
 * Playwright's `BrowserContext.storageState()` JSON shape — the bits that
 * Selenium can replay via `driver.manage().addCookie(...)` and
 * `JavascriptExecutor` (window.localStorage).
 *
 * sessionStorage is intentionally omitted: Selenium can write it but it dies
 * the moment the test driver navigates away, so it's not portable.
 */
export interface AuthState {
  /**
   * Origin URL to "prime" the browser on before applying cookies/localStorage.
   * Cookies require the driver to already be on the matching domain, and
   * localStorage is per-origin — both demand a `driver.get(originUrl)` first.
   * Typically the scheme + host of the crawled site (e.g. `https://www.saucedemo.com/`).
   */
  originUrl: string;

  cookies: AuthCookie[];

  /**
   * Per-origin localStorage entries. One bucket per origin, each containing a
   * flat list of `{name, value}` pairs to write via window.localStorage.setItem.
   */
  origins: AuthOriginStorage[];
}

export interface AuthCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  /** Unix epoch seconds. -1 / undefined means session cookie (no expiry). */
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  /** "Strict" | "Lax" | "None" — passed straight through to Selenium. */
  sameSite?: string;
}

export interface AuthOriginStorage {
  origin: string;
  localStorage: Array<{ name: string; value: string }>;
}

/**
 * Compute the union of all per-page tags in a CodegenInput. Used by every
 * emitter to render class-level test categorisation annotations
 * (`@Tag("smoke")`, `@pytest.mark.smoke`, `tag: ['@smoke']`, etc.) so users
 * can run `mvn test -Dgroups=smoke` / `pytest -m critical-path` /
 * `playwright test --grep @smoke` against the generated suites.
 *
 * Returns the deduped, "smoke-pinned-first" sorted list. Empty array when
 * no pages carry tags (the legacy / pre-tags codepath); emitters MUST
 * skip rendering annotations entirely in that case so old fixtures still
 * compile cleanly.
 */
export function dominantTags(input: CodegenInput): string[] {
  if (!input.pages || input.pages.length === 0) return [];
  const set = new Set<string>();
  for (const p of input.pages) {
    if (!p.tags) continue;
    for (const t of p.tags) if (typeof t === "string" && t.length > 0) set.add(t);
  }
  return [...set].sort((a, b) => {
    if (a === "smoke" && b !== "smoke") return -1;
    if (b === "smoke" && a !== "smoke") return 1;
    return a.localeCompare(b);
  });
}

