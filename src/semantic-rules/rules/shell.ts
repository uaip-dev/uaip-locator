/**
 * Shell category rules — chrome that wraps the content area.
 *
 * These rules are unusual because "top-nav" applies to essentially every
 * page in a SaaS app. That's fine: the codegen uses the *highest-confidence
 * non-shell* label to name a page object. Shell labels are still useful for
 * the dashboard (so you can tell "this page really is just the shell with
 * no detectable content") and for downstream flow-graph analysis.
 */
import type { PageRule } from "./types.js";
import {
  countElements,
  hasAnyText,
  hasLink,
} from "./predicates.js";

const rules: PageRule[] = [
  {
    id: "top-nav",
    label: "top-nav",
    category: "shell",
    description: "Page has an ARIA navigation region containing multiple links.",
    match: (page) => {
      const navs = page.elements.filter((el) => el.role === "navigation" || el.tag === "nav");
      if (navs.length === 0) return null;
      const navLinks = countElements(
        page,
        (el) => el.role === "link" || el.tag === "a",
      );
      if (navLinks >= 3) return 0.7;
      return null;
    },
  },
  {
    id: "side-nav",
    label: "side-nav",
    category: "shell",
    description: "Vertical navigation sidebar with accessibleName 'sidebar'/'navigation'.",
    match: (page) => {
      const sideNav = page.elements.some(
        (el) =>
          (el.role === "navigation" || el.tag === "nav")
          && /(sidebar|side.?nav|main.?nav|primary)/i.test(
            (el.accessibleName ?? "") + " " + (el.attrs.ariaLabel ?? "") + " " + (el.attrs.className ?? ""),
          ),
      );
      if (sideNav) return 0.72;
      return null;
    },
  },
  {
    id: "breadcrumbs",
    label: "breadcrumbs",
    category: "shell",
    description: "Breadcrumb trail (role=navigation with 'breadcrumb' label).",
    match: (page) => {
      const hit = page.elements.some(
        (el) =>
          (el.role === "navigation" || el.tag === "nav")
          && /breadcrumb/i.test(
            (el.accessibleName ?? "") + " " + (el.attrs.ariaLabel ?? "") + " " + (el.attrs.className ?? ""),
          ),
      );
      if (hit) return 0.85;
      return null;
    },
  },
  {
    id: "modal-dialog",
    label: "modal-dialog",
    category: "shell",
    description: "Open modal / dialog / alertdialog region in the DOM.",
    match: (page) => {
      const dialogs = countElements(
        page,
        (el) => el.role === "dialog" || el.role === "alert" || el.tag === "dialog",
      );
      if (dialogs >= 1) return 0.8;
      return null;
    },
  },
  {
    id: "toast",
    label: "toast",
    category: "shell",
    description: "Transient status / alert region present (e.g. saved / copied notification).",
    match: (page) => {
      const hit = page.elements.some(
        (el) =>
          (el.role === "status" || el.role === "alert")
          && (el.accessibleName ?? el.text ?? "").trim().length > 0,
      );
      if (hit) return 0.65;
      return null;
    },
  },
  {
    id: "empty-state",
    label: "empty-state",
    category: "shell",
    description: "Generic empty-state illustration + CTA pattern.",
    match: (page) => {
      const copy = hasAnyText(
        page,
        /(no items yet|nothing here yet|get started by|create your first)/,
      );
      if (copy) return 0.75;
      return null;
    },
  },
  {
    id: "footer",
    label: "footer",
    category: "shell",
    description: "Contentinfo / footer with nav + copyright.",
    match: (page) => {
      const footer = page.elements.some(
        (el) => el.role === "region" && /footer|contentinfo/i.test(el.accessibleName ?? ""),
      ) || page.elements.some((el) => el.tag === "footer");
      const copyright = hasAnyText(page, /©|copyright|all rights reserved/);
      if (footer && copyright) return 0.8;
      if (footer) return 0.55;
      return null;
    },
  },
];

export default rules;
