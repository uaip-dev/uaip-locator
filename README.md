# uaip-locator

> Crawl any public website. Get a Playwright TypeScript test suite. In your repo. Running.

```bash
npx @uaip/locator crawl https://saucedemo.com --out ./tests
cd tests && npx playwright install chromium && npx playwright test
```

That's it. No signup, no SaaS, no telemetry, no LLM API keys. Your computer crawls the site, picks resilient selectors, and writes you working `*.spec.ts` files plus Page Objects.

## What it does

1. **Crawls** the URL you point it at, up to N pages, respecting same-origin scope.
2. **Labels** each page with a category (login, cart, search, profile, etc.) using ~40 hand-tuned heuristic rules.
3. **Picks selectors** for every interactive element — multi-strategy: `getByRole` first, fallback to `getByText` / `getByLabel` / `#id` / `[data-testid]` / specific CSS, with a confidence score per candidate.
4. **Builds a flow graph** of how pages link to each other and discovers the highest-value user journeys (login → checkout, search → product → cart, etc.).
5. **Generates Playwright TS code** — one Page Object per crawled page, one `*.spec.ts` per scenario, plus a `playwright.config.ts` you can run as-is.

The output looks like a Playwright suite a careful engineer would write by hand. You're not locked into any framework or runtime — it's just code.

## Install

```bash
# Run once, no install:
npx @uaip/locator crawl https://example.com --out ./tests

# Or install globally:
npm i -g @uaip/locator
uaip-locator --help
```

Requires Node 20+. Playwright browsers are installed on first crawl.

## Usage

```bash
# Crawl + emit tests in one shot
uaip-locator crawl https://saucedemo.com --out ./tests

# Limit how far the crawl walks
uaip-locator crawl https://example.com --max-pages 25 --max-depth 2

# Watch the crawl in a real browser window (debugging)
uaip-locator crawl https://example.com --headed

# Restrict scope to a path prefix
uaip-locator crawl https://example.com --scope-prefix /docs/

# Re-emit tests from a saved crawl.json (offline, fast)
uaip-locator emit ./tests/crawl.json --out ./tests

# Check your environment
uaip-locator doctor
```

## What the output looks like

```
tests/
├── crawl.json                   ← raw crawl data (deterministic re-emit input)
├── uaip-manifest.json           ← framework + version + page count
├── playwright.config.ts
├── pages/
│   ├── LoginPage.ts             ← one Page Object per crawled page
│   ├── ProductsPage.ts
│   └── CartPage.ts
└── tests/
    ├── Login.spec.ts            ← one spec per discovered journey
    └── PurchaseFlow.spec.ts
```

Every Page Object holds multi-strategy locators. Every spec is annotated with `@smoke` / `@critical-path` tags. Soft assertions (`expect.soft`) are used so a single visibility miss doesn't abort the whole journey.

## Scope: what's in, what's not

✅ **Public websites** — anything you can reach without signing in.
✅ **Multi-page crawls** — same-origin, configurable depth, includes login/checkout/search journey discovery.
✅ **Playwright TypeScript** — single supported emitter.
✅ **Offline operation** — no API calls, no telemetry, no auth required.

❌ **Authenticated crawls** — login/storageState support is intentionally not in this OSS version.
❌ **Other frameworks** — Selenium / Cypress / UiPath / Playwright Java / Playwright Python emitters are out of scope here.
❌ **Self-healing tests** — when the UI changes and your selectors break, you fix them. The diff-and-propose engine is closed-source.
❌ **Trace viewer / dashboard / scheduling / team workflow** — none of that lives here.

If you need any of the ❌ items, see [UAIP hosted](https://uaip.dev). Same selector engine, much more around it.

## How it picks selectors

In priority order:

1. `page.getByRole('button', { name: 'Submit' })` — Playwright's recommended pattern, accessibility-aware.
2. `page.getByLabel('Email')` — for form inputs with associated labels.
3. `page.getByText('Sign in', { exact: true })` — when a unique exact-text match exists.
4. `page.locator('#submit')` — id-based fallback if no semantic locator works.
5. `page.locator('[data-testid=…]')` — when the site uses test ids (we detect them).
6. CSS / XPath as a last resort, structurally-anchored (no broad `.btn` selectors).

When multiple strategies tie or none is unambiguous, we chain them with `.or().first()` so the locator stays resilient if the DOM shifts. Strict-mode-safe by construction.

## Contributing

Selector quality and crawler heuristics are exactly the kind of contributions we want. New emitters are out of scope here on purpose — the OSS stays single-emitter, multi-framework codegen lives in the hosted product.

See [CONTRIBUTING.md](./CONTRIBUTING.md). Bug reports especially appreciated when the emitter picked the wrong selector for an element — there's a dedicated issue template for those.

## License

[MIT](./LICENSE).

---

Maintaining test suites at scale (self-healing, multi-framework, team coverage)? See [uaip.dev](https://uaip.dev) — the SaaS that funds this OSS.
