/**
 * Small predicate helpers shared by rule files.
 *
 * These are not exported from the package root — they're implementation
 * details of the rule registry, intentionally kept private so we can change
 * the matching model later (e.g. add token counts, dom-subtree checks)
 * without breaking external callers.
 */
import type { PageSnapshot, UiElement } from "../../types/index.js";

export function pathname(page: PageSnapshot): string {
  try {
    return new URL(page.url).pathname.toLowerCase();
  } catch {
    return page.url.toLowerCase();
  }
}

export function titleLower(page: PageSnapshot): string {
  return (page.title ?? "").toLowerCase();
}

export function urlMatches(page: PageSnapshot, re: RegExp): boolean {
  return re.test(pathname(page)) || re.test(page.url.toLowerCase());
}

export function titleMatches(page: PageSnapshot, re: RegExp): boolean {
  return re.test(titleLower(page));
}

export function hasInput(
  page: PageSnapshot,
  match: { type?: string; nameLike?: RegExp; placeholderLike?: RegExp; ariaLabelLike?: RegExp } = {},
): boolean {
  return page.elements.some((el) => inputMatches(el, match));
}

export function countInputs(
  page: PageSnapshot,
  match: { type?: string; nameLike?: RegExp; placeholderLike?: RegExp; ariaLabelLike?: RegExp } = {},
): number {
  return page.elements.filter((el) => inputMatches(el, match)).length;
}

function inputMatches(
  el: UiElement,
  match: { type?: string; nameLike?: RegExp; placeholderLike?: RegExp; ariaLabelLike?: RegExp },
): boolean {
  if (el.tag !== "input" && el.tag !== "textarea") return false;
  if (match.type && (el.attrs.type ?? "").toLowerCase() !== match.type) return false;
  if (match.nameLike && !match.nameLike.test((el.attrs.name ?? "").toLowerCase())) return false;
  if (
    match.placeholderLike
    && !match.placeholderLike.test((el.attrs.placeholder ?? "").toLowerCase())
  )
    return false;
  if (
    match.ariaLabelLike
    && !match.ariaLabelLike.test(
      ((el.attrs.ariaLabel ?? "") + " " + (el.accessibleName ?? "")).toLowerCase(),
    )
  )
    return false;
  return true;
}

export function hasHeading(page: PageSnapshot, re: RegExp): boolean {
  return page.elements.some(
    (el) =>
      (el.role === "heading" || /^h[1-6]$/.test(el.tag))
      && re.test(normalise(el.accessibleName ?? el.text ?? "")),
  );
}

export function hasButton(page: PageSnapshot, re: RegExp): boolean {
  return page.elements.some(
    (el) =>
      (el.role === "button" || el.tag === "button")
      && re.test(normalise(el.accessibleName ?? el.text ?? "")),
  );
}

export function hasLink(page: PageSnapshot, re: RegExp): boolean {
  return page.elements.some(
    (el) =>
      (el.role === "link" || el.tag === "a")
      && re.test(normalise(el.accessibleName ?? el.text ?? "")),
  );
}

export function hasAnyText(page: PageSnapshot, re: RegExp): boolean {
  if (titleMatches(page, re)) return true;
  const aria = ariaText(page);
  if (aria && re.test(aria)) return true;
  return page.elements.some((el) => {
    const s = normalise((el.accessibleName ?? "") + " " + (el.text ?? ""));
    return s ? re.test(s) : false;
  });
}

export function ariaText(page: PageSnapshot): string {
  const snap = (page as { ariaSnapshot?: unknown }).ariaSnapshot;
  if (typeof snap === "string") return snap.toLowerCase();
  if (snap && typeof snap === "object") return JSON.stringify(snap).toLowerCase();
  return "";
}

export function countElements(
  page: PageSnapshot,
  pred: (el: UiElement) => boolean,
): number {
  return page.elements.filter(pred).length;
}

function normalise(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}
