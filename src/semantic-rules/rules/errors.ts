/**
 * Errors category rules — 404, 500, validation, session-expired.
 *
 * Error pages are usually content-only (a headline + a recovery link) so
 * these rules rely heavily on text matching against the heading and body.
 */
import type { PageRule } from "./types.js";
import {
  hasAnyText,
  hasHeading,
  urlMatches,
} from "./predicates.js";

const rules: PageRule[] = [
  {
    id: "error-404",
    label: "error-404",
    category: "errors",
    description: "Page not found / 404.",
    match: (page) => {
      const heading = hasHeading(page, /\b(404|page not found|we couldn'?t find|lost in space)\b/);
      const body = hasAnyText(page, /\b(404|page (you're looking for|does not exist|not found))\b/);
      const urlHit = urlMatches(page, /\b(404|not-?found)\b/);
      if (heading || urlHit) return 0.9;
      if (body) return 0.7;
      return null;
    },
  },
  {
    id: "error-500",
    label: "error-500",
    category: "errors",
    description: "Server error / 500 / something went wrong.",
    match: (page) => {
      const heading = hasHeading(page, /\b(500|server error|something went wrong|internal error)\b/);
      const body = hasAnyText(page, /\b(server error|try again later|unexpected error)\b/);
      const urlHit = urlMatches(page, /\b(500|error)\b/);
      if (heading) return 0.9;
      if (urlHit && body) return 0.8;
      if (body) return 0.6;
      return null;
    },
  },
  {
    id: "form-validation",
    label: "form-validation",
    category: "errors",
    description: "Form page currently showing one or more validation errors.",
    match: (page) => {
      const alerts = page.elements.filter((el) => el.role === "alert").length;
      const invalidAria = page.elements.filter(
        (el) => (el.attrs.ariaLabel ?? "").toLowerCase().includes("error"),
      ).length;
      const msg = hasAnyText(
        page,
        /(please (enter|fill|provide)|is required|invalid|not valid|must be|too short|too long)/,
      );
      if (alerts >= 1 && msg) return 0.85;
      if (invalidAria >= 1 && msg) return 0.75;
      return null;
    },
  },
  {
    id: "session-expired",
    label: "session-expired",
    category: "errors",
    description: "Session-expired / please-sign-in-again interstitial.",
    match: (page) => {
      const hit = hasAnyText(
        page,
        /(session.*(expired|timed out)|please (sign|log) in again|you were signed out)/,
      );
      if (hit) return 0.85;
      return null;
    },
  },
];

export default rules;
