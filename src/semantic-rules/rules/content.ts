/**
 * Content category rules — search, filtering, pagination, no-results.
 *
 * Content pages are noisier than auth/commerce because every app has its
 * own list widget. We lean on role-based signals (searchbox, listbox, list
 * + repeated listitem) that are stable across UI libraries.
 */
import type { PageRule } from "./types.js";
import {
  countElements,
  hasAnyText,
  hasButton,
  hasHeading,
  hasInput,
  hasLink,
  urlMatches,
} from "./predicates.js";

const rules: PageRule[] = [
  {
    id: "search-results",
    label: "search-results",
    category: "content",
    description: "Search box + N results + optional 'N results for X' heading.",
    match: (page) => {
      const hasSearch = hasInput(page, { ariaLabelLike: /search/ })
        || hasInput(page, { nameLike: /^(q|query|search|s)$/ })
        || hasInput(page, { placeholderLike: /^\s*search/ });
      const urlHit = urlMatches(page, /\b(search|results|q=)\b/) || /[?&]q=/.test(page.url);
      const resultsHeader = hasAnyText(page, /\d+\s+results?\b/)
        || hasHeading(page, /(search results|results for)/);
      if (hasSearch && urlHit && resultsHeader) return 0.95;
      if (urlHit && resultsHeader) return 0.88;
      if (hasSearch && urlHit) return 0.7;
      return null;
    },
  },
  {
    id: "filter-sidebar",
    label: "filter-sidebar",
    category: "content",
    description: "Sidebar of facet/filter checkboxes or dropdowns.",
    match: (page) => {
      const checkboxes = countElements(
        page,
        (el) => el.role === "checkbox" || (el.tag === "input" && el.attrs.type === "checkbox"),
      );
      const filterLabel = hasHeading(page, /(filter|refine|narrow)/)
        || hasButton(page, /(apply filters?|clear filters?)/);
      if (checkboxes >= 4 && filterLabel) return 0.85;
      if (checkboxes >= 6) return 0.7;
      return null;
    },
  },
  {
    id: "sort-picker",
    label: "sort-picker",
    category: "content",
    description: "Dropdown labelled 'sort by' with typical sort options.",
    match: (page) => {
      const sortCombo = page.elements.some(
        (el) =>
          (el.role === "combobox" || el.tag === "select")
          && /(sort|order)/i.test((el.accessibleName ?? "") + " " + (el.attrs.ariaLabel ?? "")),
      );
      if (sortCombo) return 0.8;
      return null;
    },
  },
  {
    id: "pagination",
    label: "pagination",
    category: "content",
    description: "Paging controls (next/prev/numbered).",
    match: (page) => {
      const nav = page.elements.some(
        (el) =>
          el.role === "navigation"
          && /(pagination|pages)/i.test((el.accessibleName ?? "") + " " + (el.attrs.ariaLabel ?? "")),
      );
      const nextLink = hasLink(page, /^(next|older)\b/) || hasButton(page, /^next\b/);
      const prevLink = hasLink(page, /^(prev(ious)?|newer)\b/) || hasButton(page, /^prev\b/);
      const pageNums = countElements(
        page,
        (el) =>
          (el.role === "link" || el.tag === "a")
          && /^\d{1,3}$/.test((el.accessibleName ?? el.text ?? "").trim()),
      );
      if (nav) return 0.9;
      if (nextLink && prevLink) return 0.82;
      if (pageNums >= 3) return 0.78;
      return null;
    },
  },
  {
    id: "infinite-scroll",
    label: "infinite-scroll",
    category: "content",
    description: "Load-more CTA or scroll-triggered feed (detected by CTA wording).",
    match: (page) => {
      if (hasButton(page, /(load more|show more|view more)\b/)) return 0.7;
      return null;
    },
  },
  {
    id: "detail-page",
    label: "detail-page",
    category: "content",
    description: "Single article/post with a heading + paragraph content.",
    match: (page) => {
      const urlHit = urlMatches(page, /\/(post|article|blog|p|news)\/[^/]+/);
      const h1 = countElements(page, (el) => el.tag === "h1" || el.role === "heading");
      if (urlHit && h1 >= 1) return 0.7;
      return null;
    },
  },
  {
    id: "no-results",
    label: "no-results",
    category: "content",
    description: "Search or list page that rendered zero rows.",
    match: (page) => {
      const empty = hasAnyText(
        page,
        /(no results|nothing to show|couldn'?t find|0 results?\b|empty list)/,
      );
      if (empty) return 0.85;
      return null;
    },
  },
];

export default rules;
