# Changelog

All notable changes to `@uaip/locator` are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-05-02

Initial public release. The OSS spin-out of the UAIP crawl-and-emit pipeline.

### Added
- `crawl` command: walks a public website same-origin, builds a flow graph, identifies user journeys, generates a complete Playwright TypeScript test suite (Page Objects + specs + config).
- `emit` command: re-emits tests from a saved `crawl.json` without re-crawling. Useful for tweaking the emitter and seeing the effect on existing crawl data.
- `doctor` command: validates Node version + Playwright installation + write permissions in the output dir.
- Multi-strategy selectors (role → label → text → id → testid → css → xpath) with confidence scoring per candidate.
- Strict-mode-safe `.or()` chains with `.first()` collapse — no broad fallbacks that explode the locator.
- 39 page-classification rules covering auth / commerce / content / account / shell / errors categories.
- Flow-graph-based journey discovery — finds high-value paths like login → checkout, search → product → cart automatically.
- `uaip-manifest.json` emitted at the bundle root so downstream tooling can detect and continue with the suite.

### Not in v0.1 (intentionally)
- Authenticated crawls. Public sites only. The hosted UAIP supports login flows.
- Multi-framework codegen. Playwright TypeScript only here. The hosted UAIP supports Selenium Java/Python, Playwright Java/Python, Cypress, UiPath.
- Self-healing. Closed-source by design.
- Telemetry. None. Ever.

[Unreleased]: https://github.com/uaip/uaip-locator/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/uaip/uaip-locator/releases/tag/v0.1.0
