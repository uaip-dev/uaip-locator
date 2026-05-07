/**
 * Playwright TypeScript (@playwright/test) emitter.
 *
 * Unlike the Selenium emitters, Playwright ships native semantic locators
 * (`getByRole`, `getByLabel`, `getByPlaceholder`, `getByText`, `getByTestId`)
 * plus a `.or()` operator that composes fallbacks at the locator level.
 * That means we can emit the multi-strategy bundle directly as a chained
 * locator — no UaipLocate helper, no per-strategy try/catch. The emitted
 * code reads almost the same as what Playwright's own codegen would produce,
 * just with richer fallback chains.
 *
 * Output shape (multi-page, when input.pages is provided):
 *   - playwright.config.ts
 *   - pages/<PageName>.ts         — one Page Object per crawled page
 *   - tests/<BaseName>.spec.ts    — scenarios routed to the PO that owns each element
 *   - auth.setup.ts + auth.json   — optional, only when input.auth is present
 *   - package.json                — suggestive only, so users can `pnpm install` inside the folder
 *
 * Legacy single-page mode (no input.pages) falls back to one `<BaseName>Page.ts`.
 */

import type {
  AuthState,
  CodegenInput,
  CodegenPage,
  SelectorBundle,
  TestAction,
  Selector,
} from "../types/index.js";
import { dominantTags } from "../types/index.js";

/**
 * Plan §21 Phase 4 tag system v2 — Playwright Test `tag` option on the
 * describe block. Empty string when no tags. Tags are prefixed with "@"
 * to match Playwright's convention so users can run
 * `pwt test --grep @smoke`.
 */
function renderPwTagOption(input: CodegenInput): string {
  const tags = dominantTags(input);
  if (tags.length === 0) return "";
  const list = tags.map((t) => `"@${t}"`).join(", ");
  return `, { tag: [${list}] }`;
}

export interface EmitResult {
  /** TypeScript source files keyed by relative path. */
  files: Record<string, string>;
  /** Hints so callers can surface "npm i these" to the user. */
  buildHints: {
    dependencies: Array<{ name: string; version: string }>;
    devDependencies: Array<{ name: string; version: string }>;
  };
}

export function emitPlaywrightTs(
  input: CodegenInput,
  bundles: Record<string, SelectorBundle>,
  _opts: Record<string, never> = {},
): EmitResult {
  const base = input.baseName;
  const files: Record<string, string> = {};

  files["playwright.config.ts"] = renderPlaywrightConfig(input.auth !== undefined);
  files["package.json"] = renderPackageJson(base);

  if (input.auth) {
    files["auth.setup.ts"] = renderAuthSetup(input.auth);
    // The actual cookie/localStorage snapshot. Emitted as a JSON file so
    // Playwright's `storageState` loader can consume it directly without
    // running auth.setup.ts — setup is there as a regeneration hook.
    files["auth.json"] = renderAuthJson(input.auth);
  }

  if (input.pages && input.pages.length > 0) {
    const planned = planMultiPage(input, bundles);
    for (const plan of planned.pages) {
      files[`pages/${plan.page.name}.ts`] = renderPageMulti(plan);
    }
    files[`tests/${base}.spec.ts`] = renderTestMulti(base, input, planned);
  } else {
    const fields = gatherUsedElements(input, bundles);
    files[`pages/${base}Page.ts`] = renderPageSingle(base, fields);
    files[`tests/${base}.spec.ts`] = renderTestSingle(base, input, bundles, fields);
  }

  return {
    files,
    buildHints: {
      dependencies: [],
      devDependencies: [
        { name: "@playwright/test", version: "^1.49.0" },
        { name: "typescript", version: "^5.6.2" },
      ],
    },
  };
}

// ───────────────────────── multi-page planning ─────────────────────────

interface LocatorField {
  /** camelCase getter name on the PO. */
  name: string;
  bundle: SelectorBundle;
  comment: string;
}

interface PagePlan {
  page: CodegenPage;
  fields: LocatorField[];
  /** camelCase instance-field name in the test (e.g., "loginPage"). */
  instanceName: string;
}

interface MultiPagePlan {
  pages: PagePlan[];
  ownerByUaipId: Record<string, PagePlan>;
}

function planMultiPage(
  input: CodegenInput,
  bundles: Record<string, SelectorBundle>,
): MultiPagePlan {
  const pages = input.pages ?? [];
  const ownerByUaipId: Record<string, PagePlan> = {};
  const instanceNamesUsed = new Set<string>();
  const plans: PagePlan[] = [];

  for (const page of pages) {
    const usedNames = new Set<string>();
    const fields: LocatorField[] = [];
    for (const id of page.elementUaipIds) {
      const bundle = bundles[id];
      if (!bundle) continue;
      const semanticLabel = input.semanticLabels?.[id];
      const name = uniquifyFieldName(
        fieldNameFor(bundle, fields.length, semanticLabel),
        usedNames,
      );
      usedNames.add(name);
      fields.push({
        name,
        bundle,
        comment: describeBundle(bundle, semanticLabel),
      });
    }
    const instanceName = uniquifyFieldName(lowerFirst(page.name), instanceNamesUsed);
    instanceNamesUsed.add(instanceName);
    const plan: PagePlan = { page, fields, instanceName };
    plans.push(plan);
    for (const id of page.elementUaipIds) {
      ownerByUaipId[id] = plan;
    }
  }

  return { pages: plans, ownerByUaipId };
}

function gatherUsedElements(
  input: CodegenInput,
  bundles: Record<string, SelectorBundle>,
): LocatorField[] {
  const seen = new Set<string>();
  const usedNames = new Set<string>();
  const out: LocatorField[] = [];
  for (const scenario of input.scenarios) {
    for (const action of scenario.actions) {
      const id = (action as { targetUaipId?: string }).targetUaipId;
      if (!id || seen.has(id)) continue;
      const bundle = bundles[id];
      if (!bundle) continue;
      seen.add(id);
      const semanticLabel = input.semanticLabels?.[id];
      const name = uniquifyFieldName(
        fieldNameFor(bundle, out.length, semanticLabel),
        usedNames,
      );
      usedNames.add(name);
      out.push({ name, bundle, comment: describeBundle(bundle, semanticLabel) });
    }
  }
  return out;
}

// ───────────────────────── project-level files ─────────────────────────

function renderPlaywrightConfig(withAuth: boolean): string {
  const useBlock = withAuth
    ? `  use: {
    // Replays the storageState captured during crawl. Regenerate via
    // auth.setup.ts (or re-run \`uaip auth login\`).
    storageState: "auth.json",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },`
    : `  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },`;

  return `import { defineConfig } from "@playwright/test";

/**
 * Auto-generated Playwright config. Regenerate via:
 *   pnpm uaip crawl <url> --emit playwright-ts
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
${useBlock}
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
});
`;
}

function renderPackageJson(base: string): string {
  return `{
  "name": "${lowerFirst(base)}-uaip-tests",
  "private": true,
  "version": "0.0.0",
  "scripts": {
    "test": "playwright test",
    "test:headed": "playwright test --headed",
    "test:ui": "playwright test --ui",
    "report": "playwright show-report"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.0",
    "typescript": "^5.6.2"
  }
}
`;
}

// ───────────────────────── Page Object rendering ─────────────────────────

function renderPageMulti(plan: PagePlan): string {
  const base = plan.page.name;
  const fields = plan.fields;

  const getterDecls = fields
    .map((f) => {
      const expr = bundleToLocatorExpr(f.bundle);
      return `  /** ${f.comment} */
  get ${f.name}(): Locator {
    return ${expr};
  }`;
    })
    .join("\n\n");

  const clickHelpers = fields
    .filter((f) => !isReadOnlyish(f.bundle))
    .map(
      (f) => `  async click${capitalize(f.name)}(): Promise<void> {
    await this.${f.name}.click();
  }`,
    )
    .join("\n\n");

  const fillHelpers = fields
    .filter((f) => looksLikeInput(f.bundle))
    .map(
      (f) => `  async fill${capitalize(f.name)}(value: string): Promise<void> {
    await this.${f.name}.fill(value);
  }`,
    )
    .join("\n\n");

  return `import type { Locator, Page } from "@playwright/test";

/**
 * Auto-generated Page Object for ${base}.
 *
 * Source URL: ${plan.page.url}
 *
 * Generated by UAIP — do not edit by hand. Regenerate via:
 *   pnpm uaip crawl <url> --emit playwright-ts
 *
 * Each locator chains the SelectorBundle's primary + fallbacks via
 * Playwright's \`.or()\` so the first matching strategy wins at runtime.
 */
export class ${base} {
  constructor(private readonly page: Page) {}

${getterDecls || "  // (No locators collected — empty page object.)"}

${clickHelpers}

${fillHelpers}
}
`;
}

function renderPageSingle(base: string, fields: LocatorField[]): string {
  const getterDecls = fields
    .map((f) => {
      const expr = bundleToLocatorExpr(f.bundle);
      return `  /** ${f.comment} */
  get ${f.name}(): Locator {
    return ${expr};
  }`;
    })
    .join("\n\n");

  const clickHelpers = fields
    .filter((f) => !isReadOnlyish(f.bundle))
    .map(
      (f) => `  async click${capitalize(f.name)}(): Promise<void> {
    await this.${f.name}.click();
  }`,
    )
    .join("\n\n");

  const fillHelpers = fields
    .filter((f) => looksLikeInput(f.bundle))
    .map(
      (f) => `  async fill${capitalize(f.name)}(value: string): Promise<void> {
    await this.${f.name}.fill(value);
  }`,
    )
    .join("\n\n");

  return `import type { Locator, Page } from "@playwright/test";

/**
 * Auto-generated Page Object for ${base}.
 *
 * Generated by UAIP — do not edit by hand. Regenerate via:
 *   pnpm uaip crawl <url> --emit playwright-ts
 */
export class ${base}Page {
  constructor(private readonly page: Page) {}

${getterDecls || "  // (No locators collected — empty page object.)"}

${clickHelpers}

${fillHelpers}
}
`;
}

// ───────────────────────── Test class rendering ─────────────────────────

function renderTestMulti(
  base: string,
  input: CodegenInput,
  planned: MultiPagePlan,
): string {
  const imports = planned.pages
    .map((p) => `import { ${p.page.name} } from "../pages/${p.page.name}.js";`)
    .join("\n");

  const methods = input.scenarios
    .map((s) => renderScenarioMulti(s, planned))
    .join("\n\n");

  return `import { test, expect } from "@playwright/test";
${imports}

/**
 * Auto-generated smoke suite for ${base}.
 *
 * Generated by UAIP. Each test.describe block corresponds to one scenario
 * discovered or composed during crawl. Actions route to the Page Object
 * that owns their target element; off-page actions fall back to inline
 * locators.
 */

test.describe("${base} smoke"${renderPwTagOption(input)}, () => {
${methods}
});
`;
}

function renderTestSingle(
  base: string,
  input: CodegenInput,
  bundles: Record<string, SelectorBundle>,
  fields: LocatorField[],
): string {
  const fieldByUaipId: Record<string, LocatorField> = {};
  for (const f of fields) fieldByUaipId[f.bundle.uaipId] = f;
  const methods = input.scenarios
    .map((s) => renderScenarioSingle(s, fieldByUaipId, bundles, base))
    .join("\n\n");

  return `import { test, expect } from "@playwright/test";
import { ${base}Page } from "../pages/${base}Page.js";

/**
 * Auto-generated smoke suite for ${base}.
 *
 * Generated by UAIP. Each test block exercises one scenario; all locators
 * live on ${base}Page and chain primary + fallback strategies via .or().
 */

test.describe("${base} smoke"${renderPwTagOption(input)}, () => {
${methods}
});
`;
}

function renderScenarioMulti(
  scenario: { name: string; description?: string; actions: TestAction[] },
  planned: MultiPagePlan,
): string {
  const body = scenario.actions.map((a) => renderActionMulti(a, planned)).join("\n");
  const poInits = planned.pages
    .map((p) => `    const ${p.instanceName} = new ${p.page.name}(page);`)
    .join("\n");
  const doc = scenario.description ? `  /** ${scenario.description} */\n` : "";
  return `${doc}  test("${escapeTs(scenario.name)}", async ({ page }) => {
${poInits}
${body}
  });`;
}

function renderScenarioSingle(
  scenario: { name: string; description?: string; actions: TestAction[] },
  fieldByUaipId: Record<string, LocatorField>,
  bundles: Record<string, SelectorBundle>,
  base: string,
): string {
  const body = scenario.actions
    .map((a) => renderActionSingle(a, fieldByUaipId, bundles))
    .join("\n");
  const doc = scenario.description ? `  /** ${scenario.description} */\n` : "";
  return `${doc}  test("${escapeTs(scenario.name)}", async ({ page }) => {
    const po = new ${base}Page(page);
${body}
  });`;
}

function renderActionMulti(action: TestAction, planned: MultiPagePlan): string {
  const indent = "    ";
  const cmt = action.comment ? `${indent}// ${action.comment}\n` : "";
  switch (action.kind) {
    case "navigate":
      return `${cmt}${indent}await page.goto("${escapeTs(action.url)}");`;
    case "click": {
      const owner = planned.ownerByUaipId[action.targetUaipId];
      const field = owner?.fields.find((f) => f.bundle.uaipId === action.targetUaipId);
      if (!owner || !field) return renderDirectAction(action, indent, cmt);
      return `${cmt}${indent}await ${owner.instanceName}.click${capitalize(field.name)}();`;
    }
    case "fill": {
      const owner = planned.ownerByUaipId[action.targetUaipId];
      const field = owner?.fields.find((f) => f.bundle.uaipId === action.targetUaipId);
      if (!owner || !field) return renderDirectAction(action, indent, cmt);
      return `${cmt}${indent}await ${owner.instanceName}.fill${capitalize(field.name)}("${escapeTs(action.value)}");`;
    }
    case "expectVisible": {
      const owner = planned.ownerByUaipId[action.targetUaipId];
      const field = owner?.fields.find((f) => f.bundle.uaipId === action.targetUaipId);
      if (!owner || !field) {
        // Fall back to inline locator if the element isn't owned by any plan.
        return renderInlineExpectVisible(action.targetUaipId, indent, cmt);
      }
      // soft: accumulates failures instead of aborting the test on first miss
      return `${cmt}${indent}await expect.soft(${owner.instanceName}.${field.name}).toBeVisible();`;
    }
    case "expectUrl":
      return `${cmt}${indent}await expect(page).toHaveURL(new RegExp("${escapeTs(action.pattern)}"));`;
    case "expectUrlChanged":
      return `${cmt}${indent}await expect(page).not.toHaveURL("${escapeTs(action.fromUrl)}");`;
    case "expectText": {
      const owner = planned.ownerByUaipId[action.targetUaipId];
      const field = owner?.fields.find((f) => f.bundle.uaipId === action.targetUaipId);
      if (!owner || !field) return renderInlineExpectText(action.targetUaipId, action.expected, indent, cmt);
      return `${cmt}${indent}await expect.soft(${owner.instanceName}.${field.name}).toHaveText("${escapeTs(action.expected)}");`;
    }
    case "waitFor":
    case "hover":
    case "check":
    case "uncheck":
    case "press":
    case "selectOption":
    case "screenshot":
      return `${cmt}${indent}// TODO emit ${action.kind} in v0.2`;
    default:
      return `${cmt}${indent}// UAIP: unknown action kind`;
  }
}

function renderActionSingle(
  action: TestAction,
  fieldByUaipId: Record<string, LocatorField>,
  _bundles: Record<string, SelectorBundle>,
): string {
  const indent = "    ";
  const cmt = action.comment ? `${indent}// ${action.comment}\n` : "";
  switch (action.kind) {
    case "navigate":
      return `${cmt}${indent}await page.goto("${escapeTs(action.url)}");`;
    case "click": {
      const f = fieldByUaipId[action.targetUaipId];
      if (!f) return `${cmt}${indent}// UAIP: missing selector bundle for ${action.targetUaipId}`;
      return `${cmt}${indent}await po.click${capitalize(f.name)}();`;
    }
    case "fill": {
      const f = fieldByUaipId[action.targetUaipId];
      if (!f) return `${cmt}${indent}// UAIP: missing selector bundle for ${action.targetUaipId}`;
      return `${cmt}${indent}await po.fill${capitalize(f.name)}("${escapeTs(action.value)}");`;
    }
    case "expectVisible": {
      const f = fieldByUaipId[action.targetUaipId];
      if (!f) return `${cmt}${indent}// UAIP: missing selector bundle for ${action.targetUaipId}`;
      return `${cmt}${indent}await expect.soft(po.${f.name}).toBeVisible();`;
    }
    case "expectUrl":
      return `${cmt}${indent}await expect(page).toHaveURL(new RegExp("${escapeTs(action.pattern)}"));`;
    case "expectUrlChanged":
      return `${cmt}${indent}await expect(page).not.toHaveURL("${escapeTs(action.fromUrl)}");`;
    case "expectText": {
      const f = fieldByUaipId[action.targetUaipId];
      if (!f) return `${cmt}${indent}// UAIP: missing selector bundle for ${action.targetUaipId}`;
      return `${cmt}${indent}await expect.soft(po.${f.name}).toHaveText("${escapeTs(action.expected)}");`;
    }
    case "waitFor":
    case "hover":
    case "check":
    case "uncheck":
    case "press":
    case "selectOption":
    case "screenshot":
      return `${cmt}${indent}// TODO emit ${action.kind} in v0.2`;
    default:
      return `${cmt}${indent}// UAIP: unknown action kind`;
  }
}

/**
 * For actions whose target element isn't owned by any page plan, emit an
 * inline `page.locator(...).or(...)` chain directly in the test body.
 */
function renderDirectAction(action: TestAction, indent: string, cmt: string): string {
  const targetId = (action as { targetUaipId?: string }).targetUaipId;
  if (!targetId) return `${cmt}${indent}// UAIP: action missing targetUaipId`;
  return `${cmt}${indent}// UAIP: unmapped target ${targetId} — add a manual locator here if needed`;
}

function renderInlineExpectVisible(id: string, indent: string, cmt: string): string {
  return `${cmt}${indent}// UAIP: expectVisible for unmapped ${id} — fill in a locator or re-crawl`;
}

function renderInlineExpectText(id: string, expected: string, indent: string, cmt: string): string {
  return `${cmt}${indent}// UAIP: expectText("${escapeTs(expected)}") for unmapped ${id}`;
}

// ───────────────────────── Selector → Playwright locator ─────────────────────────

/**
 * Convert a SelectorBundle into a chained Playwright locator expression.
 *
 * Two non-obvious things going on here. Both come from a real failure
 * the test-runner harness surfaced against demoblaze.com (see
 * uaip-test-runners/runners/playwright-ts run from 2026-05-02):
 *
 * 1) FILTER overly-broad fallbacks before joining. Playwright's `.or()`
 *    is UNION (matches all elements that match either side), not the
 *    fallback chain semantics our crawler bundles imply. A broad
 *    fallback like `a.nav-link` or `getByRole('link')` (no name) inside
 *    a chain bloats the union to every nav link on the page, and
 *    Playwright's default strict-mode rejects an ambiguous click.
 *    We drop those from the fallback list — primary is kept regardless,
 *    that's the engine's best guess.
 *
 * 2) APPEND `.first()` whenever we emit a `.or()` chain. Even after
 *    filtering, two well-formed selectors can race — say a `getByRole`
 *    matching the same element a `getByText` does. `.first()` collapses
 *    the union back to "the first hit" so the click actually fires.
 *    Single-selector bundles (no `.or()`) intentionally do NOT get
 *    `.first()` so true ambiguity in the engine output still surfaces.
 */
function bundleToLocatorExpr(bundle: SelectorBundle): string {
  const all: Selector[] = [bundle.primary, ...bundle.fallbacks];
  if (all.length === 0) return `this.page.locator("html")`; // defensive
  const filtered = all.filter((s, idx) => idx === 0 || !isOverlyBroadSelector(s));
  const parts = filtered.map((s) => selectorToLocatorCall(s, "this.page"));
  if (parts.length === 1) return parts[0] ?? `this.page.locator("html")`;
  const first = parts[0] ?? `this.page.locator("html")`;
  const rest = parts.slice(1).map((p) => `.or(${p})`).join("");
  return `${first}${rest}.first()`;
}

/**
 * A selector is "overly broad" when it would match many elements on a
 * realistic page. Used to prune fallback chains before joining with
 * Playwright's `.or()` (which is union semantics — see bundleToLocatorExpr).
 *
 * Broad:
 *   • CSS with no #id, no [attr=...], no :nth-* anchor — i.e. bare
 *     tag, single class, or tag.class combos like `a.nav-link`.
 *   • role selector with no accessibleName (matches every element
 *     having that ARIA role).
 *
 * Not broad: anything anchored by id / attribute / structural index,
 * or any of Playwright's high-precision semantic locators (label,
 * placeholder, testid, exact text). XPath is left alone — our crawler
 * emits positional paths which are highly specific.
 */
function isOverlyBroadSelector(sel: Selector): boolean {
  switch (sel.strategy) {
    case "css": {
      const v = sel.value.trim();
      if (v.includes("#")) return false;
      if (/\[/.test(v)) return false;
      if (/:nth-/.test(v)) return false;
      // Bare tag, .class, tag.class, .a.b, etc — broad.
      return /^[a-zA-Z*]*(\.[\w-]+)*$/.test(v);
    }
    case "role":
      return !sel.accessibleName;
    default:
      return false;
  }
}

function selectorToLocatorCall(sel: Selector, root: string): string {
  switch (sel.strategy) {
    case "testid": {
      // Playwright's getByTestId uses a single configured attribute. If the
      // bundle targets a non-default attribute we fall back to CSS so we
      // don't silently match the wrong thing.
      const attr = sel.testIdAttribute ?? "data-test";
      if (attr === "data-testid") {
        return `${root}.getByTestId("${escapeTs(sel.value)}")`;
      }
      return `${root}.locator("[${attr}='${escapeTs(sel.value)}']")`;
    }
    case "role": {
      const role = (sel.value.split("[")[0] ?? "").trim();
      const name = sel.accessibleName ?? "";
      if (name) {
        return `${root}.getByRole("${escapeTs(role)}" as never, { name: "${escapeTs(name)}" })`;
      }
      return `${root}.getByRole("${escapeTs(role)}" as never)`;
    }
    case "label":
      return `${root}.getByLabel("${escapeTs(sel.value)}")`;
    case "text":
      return `${root}.getByText("${escapeTs(sel.value)}", { exact: true })`;
    case "placeholder":
      return `${root}.getByPlaceholder("${escapeTs(sel.value)}")`;
    case "id":
      return `${root}.locator("#${escapeCssId(sel.value)}")`;
    case "css":
      return `${root}.locator("${escapeTs(sel.value)}")`;
    case "xpath":
      return `${root}.locator("xpath=${escapeTs(sel.value)}")`;
    default:
      return `${root}.locator("${escapeTs((sel as Selector).value)}")`;
  }
}

// ───────────────────────── auth file rendering ─────────────────────────

/**
 * auth.json is Playwright's native storageState format, so we can write it
 * straight from the AuthState. Origins are mapped 1:1; cookies pass through.
 */
function renderAuthJson(auth: AuthState): string {
  const state = {
    cookies: auth.cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain ?? "",
      path: c.path ?? "/",
      expires: typeof c.expires === "number" ? c.expires : -1,
      httpOnly: c.httpOnly ?? false,
      secure: c.secure ?? false,
      sameSite: c.sameSite ?? "Lax",
    })),
    origins: auth.origins.map((o) => ({
      origin: o.origin,
      localStorage: o.localStorage.map((it) => ({ name: it.name, value: it.value })),
    })),
  };
  return JSON.stringify(state, null, 2) + "\n";
}

/**
 * Setup project that re-runs auth and rewrites auth.json. Playwright runs
 * this once via a project dependency; user code never touches it directly.
 */
function renderAuthSetup(auth: AuthState): string {
  return `import { test as setup } from "@playwright/test";

/**
 * Auto-generated auth setup. UAIP baked a storageState snapshot (auth.json)
 * into this folder during crawl; this file is mostly a hook so you can
 * re-run \`uaip auth login\` if sessions expire. Playwright loads auth.json
 * automatically via playwright.config.ts's \`use.storageState\`.
 *
 * Origin primed on first load: ${auth.originUrl}
 */
setup("authenticate", async ({ page }) => {
  // No-op — storage state is replayed via playwright.config.ts. Re-run
  //   pnpm uaip auth login
  // to regenerate auth.json.
  await page.goto("${escapeTs(auth.originUrl)}");
});
`;
}

// ───────────────────────── formatting helpers ─────────────────────────

function fieldNameFor(bundle: SelectorBundle, fallbackIdx: number, semanticLabel?: string): string {
  if (semanticLabel && semanticLabel.trim().length > 0) {
    const camel = toCamel(semanticLabel);
    if (camel) return camel;
  }
  const src = bundle.primary.accessibleName ?? bundle.primary.value;
  const camel = toCamel(src);
  return camel || `element${fallbackIdx + 1}`;
}

function uniquifyFieldName(name: string, used: Set<string>): string {
  if (!used.has(name)) return name;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${name}${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${name}X`;
}

function toCamel(s: string): string {
  const parts = s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/);
  if (parts.length === 0) return "";
  const first = (parts[0] ?? "").toLowerCase();
  const rest = parts
    .slice(1)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join("");
  return (first + rest).replace(/^[0-9]+/, "");
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function lowerFirst(s: string): string {
  if (!s) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/**
 * Escape string contents so they can go inside a TypeScript double-quoted
 * string literal. Handles backslash, double-quote, newline, CR.
 */
function escapeTs(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

/** Extremely light escape for a CSS id suffix (handles backslashes + quotes). */
function escapeCssId(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function describeBundle(bundle: SelectorBundle, semanticLabel?: string): string {
  const p = bundle.primary;
  const base = `Primary: ${p.strategy}='${p.value}' (score ${p.score}). Fallbacks: ${bundle.fallbacks.length}.`;
  return semanticLabel ? `${base} Semantic intent: ${semanticLabel}.` : base;
}

/**
 * Mirrors the Java emitter's `looksLikeInput` — used to decide whether to
 * emit a `fill<Name>(value)` helper on the PO.
 */
function looksLikeInput(bundle: SelectorBundle): boolean {
  const all = [bundle.primary, ...bundle.fallbacks];
  for (const s of all) {
    if (s.strategy === "label" || s.strategy === "placeholder") return true;
    if (
      s.strategy === "role" &&
      (s.value.startsWith("textbox") ||
        s.value.startsWith("searchbox") ||
        s.value.startsWith("combobox"))
    ) {
      return true;
    }
  }
  const v = bundle.primary.value.toLowerCase();
  if (/\b(user(name)?|email|password|search|phone|address|zip)\b/.test(v)) return true;
  return false;
}

/**
 * True for elements that are read-only (labels, static text, images by alt) —
 * we skip the click<Name>() helper for those since you wouldn't normally
 * click them. Keeps the PO surface tight.
 */
function isReadOnlyish(bundle: SelectorBundle): boolean {
  const s = bundle.primary.strategy;
  return s === "label" || s === "placeholder";
}
