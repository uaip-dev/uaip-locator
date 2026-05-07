/**
 * Public API for `@uaip/locator` when used programmatically.
 *
 * Most users invoke the CLI directly. This barrel exists for the rare case
 * where someone wants to embed the crawl-and-emit pipeline in their own
 * Node tool — e.g. a custom GitHub Action or a Storybook plugin.
 *
 * The OSS API surface is intentionally smaller than the SaaS internals.
 * Anything not re-exported here is not considered part of the supported
 * contract and may change between minor versions.
 */

// Crawler
export { crawlSite, crawlPage } from "./crawler/index.js";
export type { CrawlOptions, CrawlSiteOptions } from "./crawler/index.js";

// Selector engine
export {
  generateSelectorBundle,
  generateAllBundles,
  SCORES,
} from "./selector-engine/index.js";

// Codegen (Playwright TS only)
export { emitPlaywrightTs } from "./codegen/index.js";
export type { EmitResult } from "./codegen/index.js";

// Semantic rules
export {
  ALL_RULES,
  applyPageRules,
  primaryLabel,
} from "./semantic-rules/index.js";

// Flow graph + journeys
export {
  buildFlowGraph,
  findJourneys,
} from "./flow-graph/index.js";

// Re-export the shared types so consumers don't have to dig.
export type {
  CrawlResult,
  PageSnapshot,
  UiElement,
  PageLabel,
  PageCategory,
  Selector,
  SelectorBundle,
  FlowGraph,
  Journey,
} from "./types/index.js";
