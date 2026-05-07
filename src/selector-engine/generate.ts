/**
 * Selector bundle generation.
 *
 * Given a `UiElement` (and the full element list for disambiguation), produce
 * a `SelectorBundle` containing a primary selector and ranked fallbacks.
 *
 * The strategy pipeline:
 *   1. Try every candidate strategy against the element
 *   2. Score each — lower is better
 *   3. Verify uniqueness within the page (cheap local filter) — non-unique
 *      candidates get a score penalty rather than being dropped outright
 *   4. Sort ascending by score
 *   5. Primary = best; fallbacks = the rest (capped to N for emitter sanity)
 *
 * This is deliberately framework-neutral: each candidate is a `Selector`
 * with a strategy discriminator, and emitters translate to their own
 * By.cssSelector / page.getByRole / cy.get syntax.
 */

import type {
  UiElement,
  Selector,
  SelectorBundle,
  SelectorStrategy,
} from "../types/index.js";
import { SCORES, TEST_ID_ATTRS } from "./scores.js";

const MAX_FALLBACKS = 4;
const DUPLICATE_PENALTY = 400;

export function generateAllBundles(elements: UiElement[]): Record<string, SelectorBundle> {
  const out: Record<string, SelectorBundle> = {};
  for (const el of elements) {
    if (!isWorthBundling(el)) continue;
    out[el.uaipId] = generateSelectorBundle(el, elements);
  }
  return out;
}

/**
 * Skip elements that are neither interactable nor semantically identifiable.
 *
 * The crawler keeps bare landmarks (form, nav, main) so the ariaSnapshot is
 * complete, but those without an accessible name can never participate in a
 * meaningful assertion or interaction — emitting a bundle for them just
 * pollutes the generated Page Object with a useless `form` locator whose
 * only strategies are `tag='form'` and absolute XPath.
 */
function isWorthBundling(el: UiElement): boolean {
  if (el.interactable) return true;
  if (el.accessibleName && el.accessibleName.trim().length > 0) return true;
  // test-id attributes beat everything — even a bare div with data-test is
  // an intentional anchor point, so keep it.
  for (const k of Object.keys(el.attrs.dataAttributes)) {
    if (k === "data-test" || k === "data-testid" || k === "data-qa") return true;
  }
  return false;
}

export function generateSelectorBundle(
  el: UiElement,
  context: UiElement[],
): SelectorBundle {
  const candidates: Selector[] = [];

  // 1. test-id attributes
  for (const attrName of TEST_ID_ATTRS) {
    const v = el.attrs.dataAttributes[attrName];
    if (v) {
      candidates.push({
        strategy: "testid",
        value: v,
        testIdAttribute: attrName,
        score: SCORES.TESTID,
        rationale: `Matched ${attrName}='${v}' — test ID attribute is the most stable anchor.`,
      });
    }
  }

  // 2. role + accessible name
  if (el.accessibleName && el.role !== "generic") {
    candidates.push({
      strategy: "role",
      value: `${el.role}[name="${escapeQuotes(el.accessibleName)}"]`,
      accessibleName: el.accessibleName,
      score: SCORES.ROLE_WITH_NAME,
      rationale: `ARIA role '${el.role}' with accessible name '${el.accessibleName}'.`,
    });
  }

  // 3. label (for form controls where accessibleName came from a <label>)
  if (
    (el.role === "textbox" ||
      el.role === "checkbox" ||
      el.role === "radio" ||
      el.role === "combobox") &&
    el.accessibleName
  ) {
    candidates.push({
      strategy: "label",
      value: el.accessibleName,
      score: SCORES.LABEL,
      rationale: `Form control labelled '${el.accessibleName}'.`,
    });
  }

  // 4. placeholder
  if (el.attrs.placeholder) {
    candidates.push({
      strategy: "placeholder",
      value: el.attrs.placeholder,
      score: SCORES.PLACEHOLDER,
      rationale: `Placeholder text '${el.attrs.placeholder}'.`,
    });
  }

  // 5. visible text (buttons, links)
  if (el.text && (el.role === "button" || el.role === "link") && el.text.length <= 60) {
    candidates.push({
      strategy: "text",
      value: el.text,
      score: SCORES.TEXT,
      rationale: `Visible text '${el.text}'.`,
    });
  }

  // 6. id
  if (el.attrs.id && isReasonableId(el.attrs.id)) {
    candidates.push({
      strategy: "id",
      value: el.attrs.id,
      score: SCORES.ID,
      rationale: `DOM id '${el.attrs.id}'.`,
    });
  }

  // 7. css — tag + first stable class if we can find one
  const cssSel = buildCssSelector(el);
  if (cssSel) {
    candidates.push({
      strategy: "css",
      value: cssSel,
      score: SCORES.CSS,
      rationale: `CSS selector (tag + class heuristic).`,
    });
  }

  // 8. xpath — always available as a last resort
  candidates.push({
    strategy: "xpath",
    value: el.xpath,
    score: SCORES.XPATH,
    rationale: `Absolute XPath (last-resort fallback).`,
  });

  // Apply duplicate penalty: if another element in `context` would match
  // the same selector value under the same strategy, we bump the score.
  for (const c of candidates) {
    const dupCount = countMatches(c, el, context);
    if (dupCount > 1) {
      c.score += DUPLICATE_PENALTY;
      c.rationale += ` (non-unique: ${dupCount} matches — score penalised.)`;
    }
  }

  // Sort ascending (best first) and split.
  candidates.sort((a, b) => a.score - b.score);

  const [primary, ...rest] = candidates;
  if (!primary) {
    // Should never happen since xpath always makes it in, but satisfy strict TS.
    throw new Error(`No selector candidates for ${el.uaipId}`);
  }
  const fallbacks = rest.slice(0, MAX_FALLBACKS);

  return {
    uaipId: el.uaipId,
    primary,
    fallbacks,
    stabilityScore: primary.score,
  };
}

function escapeQuotes(s: string): string {
  return s.replace(/"/g, '\\"');
}

function isReasonableId(id: string): boolean {
  // Avoid framework-generated IDs that change every render.
  if (/^[a-z]+-\d{4,}$/i.test(id)) return false; // e.g. "mui-1234"
  if (/^[a-f0-9-]{16,}$/i.test(id)) return false; // long hex/uuids
  if (id.length > 64) return false;
  return true;
}

function buildCssSelector(el: UiElement): string | undefined {
  const tag = el.tag;
  if (!el.attrs.className) return tag;
  const classes = el.attrs.className
    .split(/\s+/)
    .filter(Boolean)
    .filter((c) => isReasonableClassName(c))
    .slice(0, 2);
  if (classes.length === 0) return tag;
  return `${tag}.${classes.join(".")}`;
}

function isReasonableClassName(cls: string): boolean {
  // Filter out obvious CSS-in-JS hashes.
  if (/^css-[a-z0-9]+$/i.test(cls)) return false;
  if (/^sc-[a-z0-9]+$/i.test(cls)) return false;
  if (/^[A-Za-z]+-module_[a-z0-9_-]+__[a-z0-9]+$/i.test(cls)) return false;
  if (/^[a-f0-9]{6,}$/i.test(cls)) return false;
  if (cls.length > 40) return false;
  return true;
}

/**
 * Naive uniqueness check against the captured context. Not a perfect proxy
 * for runtime uniqueness (the live DOM may differ), but cheap and catches
 * obvious duplicates like two buttons with the same label.
 */
function countMatches(
  sel: Selector,
  owner: UiElement,
  context: UiElement[],
): number {
  let count = 0;
  for (const el of context) {
    if (matchesSelector(sel, el)) count += 1;
    if (count > 1 && el.uaipId !== owner.uaipId) return count;
  }
  return count;
}

function matchesSelector(sel: Selector, el: UiElement): boolean {
  switch (sel.strategy as SelectorStrategy) {
    case "testid": {
      const attr = sel.testIdAttribute;
      if (!attr) return false;
      return el.attrs.dataAttributes[attr] === sel.value;
    }
    case "role":
      return `${el.role}[name="${escapeQuotes(el.accessibleName ?? "")}"]` === sel.value;
    case "label":
      return el.accessibleName === sel.value;
    case "text":
      return el.text === sel.value;
    case "placeholder":
      return el.attrs.placeholder === sel.value;
    case "id":
      return el.attrs.id === sel.value;
    case "css":
      // Approximation — match on tag + first class.
      return buildCssSelector(el) === sel.value;
    case "xpath":
      return el.xpath === sel.value;
    default:
      return false;
  }
}
