/**
 * Selector strategies and bundles. This is the heart of the UAIP value prop:
 * we never output a single brittle selector — we output a ranked list, and
 * the generated test code tries them in order.
 */

/** The strategy *families* UAIP supports. Ordered by default preference. */
export type SelectorStrategy =
  | "testid" // data-test / data-testid / data-qa / data-cy
  | "role" // ARIA role + accessible name (Playwright getByRole-style)
  | "label" // associated <label> text (for form fields)
  | "text" // visible text match
  | "placeholder" // placeholder attribute
  | "id" // DOM id
  | "css" // CSS selector
  | "xpath"; // XPath expression (last resort)

/** A single selector attempt — a strategy + its concrete value + a stability score. */
export interface Selector {
  strategy: SelectorStrategy;

  /** Strategy-specific value. For `testid` it's the attribute value; for `role`
   *  it's `"role[name=...]"`; for `css`/`xpath` it's the expression itself. */
  value: string;

  /** For `role` only — accessible name, separately captured for emitter use. */
  accessibleName?: string;

  /** For `testid` only — which attribute matched. Emitters need this to produce
   *  framework-idiomatic code (`By.cssSelector("[data-test='x']")`, etc.). */
  testIdAttribute?: string;

  /**
   * Stability score. Lower is better (same convention as Playwright's internal
   * scoring — see `packages/injected/src/selectorGenerator.ts` in playwright-main).
   *
   * Anchor values (can be tuned):
   *   1    — test-id attribute (most stable)
   *   50   — role + accessible name
   *   100  — label text
   *   150  — visible text
   *   200  — placeholder
   *   300  — id
   *   500  — css
   *   1000 — xpath
   */
  score: number;

  /**
   * Human-readable rationale, surfaced in the trace viewer + PR diffs later.
   * Example: "Matched data-test='login-button' — stable test ID present."
   */
  rationale: string;
}

/**
 * A selector *bundle* is what we actually emit: a primary + ranked fallbacks.
 * Generated test code tries each in order. The first that resolves a single
 * interactable element wins.
 */
export interface SelectorBundle {
  /** The element this bundle targets (cross-references `UiElement.uaipId`). */
  uaipId: string;

  /** Primary selector — best-scoring strategy available. */
  primary: Selector;

  /** Fallbacks in score order (best-to-worst). Empty if no alternates found. */
  fallbacks: Selector[];

  /** Aggregate stability score for the bundle — currently just primary.score.
   *  Exposed separately so emitters can warn if the whole bundle is weak. */
  stabilityScore: number;
}
