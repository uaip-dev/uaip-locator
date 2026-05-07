/**
 * @uaip/core — shared types for the UAIP platform.
 *
 * Kept deliberately lean: every other package depends on these types, so churn
 * here ripples everywhere. Any addition should be justified by at least two
 * downstream consumers.
 */

export * from "./elements.js";
export * from "./selectors.js";
export * from "./crawl.js";
export * from "./actions.js";
