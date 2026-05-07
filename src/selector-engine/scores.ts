/**
 * Stability scores for each selector strategy. Lower is more stable.
 *
 * Anchor values chosen to mirror Playwright's internal scoring model
 * (see `packages/injected/src/selectorGenerator.ts` in playwright-main):
 * test IDs ≈ 1, role+name ≈ 100, CSS/XPath in the hundreds/thousands.
 *
 * We deviate in one place: we weight `label` higher (more stable) than
 * Playwright does, because QA engineers maintain labels more than they
 * maintain `data-test` attributes in legacy apps — real-world observation.
 */

export const SCORES = {
  TESTID: 1, // [data-test='x'] — gold standard
  ROLE_WITH_NAME: 50, // getByRole('button', { name: 'Submit' })
  LABEL: 100, // getByLabel('Username')
  TEXT: 150, // getByText('Submit')
  PLACEHOLDER: 200, // getByPlaceholder('Enter email')
  ID: 300, // #username
  CSS: 500, // .login-btn.primary
  XPATH: 1000, // //button[@class='login-btn']
} as const;

/** Recognised test-id attribute names, in priority order. */
export const TEST_ID_ATTRS = [
  "data-test",
  "data-testid",
  "data-qa",
  "data-cy",
] as const;
