# Contributing to uaip-locator

Thanks for considering a contribution. This is an open-source project that funds itself through the hosted UAIP SaaS — the OSS-vs-SaaS line is intentional and matters when picking what to work on.

## What's in scope here (welcome contributions)

**Selector quality.** If the engine picks a flaky or wrong selector for an element, that's the highest-signal kind of bug. Use the [Selector quality issue template](.github/ISSUE_TEMPLATE/selector_quality.yml) with HTML snippet + expected vs. actual selector.

**Crawler heuristics.** Better link-following, smarter scope detection, dealing with single-page apps that hijack navigation, etc.

**Semantic page-label rules.** The 39 rules in `src/semantic-rules/rules/` correctly classify ~80% of common pages. Adding a rule for an under-covered category (e.g. "documentation page", "API reference") is a great first PR.

**Playwright emitter improvements.** Cleaner generated code, better handling of unusual element types, smarter scenario synthesis from the flow graph.

**Documentation, examples, bug fixes.** Always welcome.

## What's NOT in scope here (please don't open a PR)

**New emitters** (Selenium / Cypress / UiPath / Playwright Java / Playwright Python). The OSS stays single-emitter on purpose — multi-framework codegen is the hosted product's differentiator. We won't merge these, even if they work. If you really want multi-framework, the hosted UAIP at uaip.dev does it.

**Self-healing.** The diff-and-propose engine that watches a CI log, identifies broken selectors, and opens a PR with fixes — that's the SaaS moat. We won't ship it here.

**Authenticated crawls.** OSS stays public-sites-only. Login flows, storageState recording, vault encryption — all SaaS.

**Dashboard / web UI / API server.** This is a CLI tool. If you want a UI, the SaaS has one.

**Telemetry / analytics phone-home.** Never. The OSS runs entirely offline.

## Development setup

```bash
git clone https://github.com/uaip/uaip-locator.git
cd uaip-locator
npm install
npx playwright install chromium

# Iterate
npm run dev -- crawl https://saucedemo.com --out ./out

# Type-check
npm run lint

# Test
npm test
```

## Pull request guidelines

1. **One concern per PR.** Easier to review, easier to revert. A selector-engine improvement and a crawler scope fix are two PRs.
2. **Tests for behavior changes.** If you tweak how the selector engine ranks candidates, add or update tests.
3. **DCO sign-off** — every commit gets a `Signed-off-by:` line (`git commit -s`). We use [Developer Certificate of Origin](https://developercertificate.org) instead of a CLA.
4. **Keep CHANGELOG.md updated** — add a line to the unreleased section describing what changed and why.
5. **Be patient.** Reviews happen weekly, not daily. Solo maintainer + day job.

## Code of Conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). Be kind. Constructive criticism is welcome; personal attacks are not.

## Releasing

Maintainer-only:

1. Bump version in `package.json` (semver).
2. Move CHANGELOG's "Unreleased" section under a new versioned heading.
3. `git tag v0.x.y && git push --tags`.
4. The release workflow publishes to npm with provenance attestation.

## Questions?

Open a Discussion on GitHub. Slack/Discord: not yet — revisit at 1k+ stars.
