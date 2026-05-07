/**
 * Account category rules — profile, settings, billing, team admin.
 *
 * These pages are the long tail of a SaaS app. URL conventions
 * (`/settings/*`, `/account/*`) are the most reliable single signal, with
 * heading + field-set shape as confirmation.
 */
import type { PageRule } from "./types.js";
import {
  hasAnyText,
  hasButton,
  hasHeading,
  hasInput,
  hasLink,
  urlMatches,
} from "./predicates.js";

const rules: PageRule[] = [
  {
    id: "profile",
    label: "profile",
    category: "account",
    description: "User profile page — name/avatar/bio fields.",
    match: (page) => {
      const urlHit = urlMatches(page, /\/(profile|me|account)(\/|$)/);
      const nameField = hasInput(page, { nameLike: /(first.?name|last.?name|full.?name|display.?name)/ });
      const avatarCTA = hasButton(page, /(upload|change)\s*(photo|avatar|picture)/);
      if (urlHit && nameField) return 0.88;
      if (urlHit && avatarCTA) return 0.78;
      return null;
    },
  },
  {
    id: "settings",
    label: "settings",
    category: "account",
    description: "General settings / preferences page.",
    match: (page) => {
      const urlHit = urlMatches(page, /\/(settings|preferences|config)(\/|$)/);
      const headingHit = hasHeading(page, /(settings|preferences)/);
      if (urlHit && headingHit) return 0.88;
      if (urlHit) return 0.7;
      return null;
    },
  },
  {
    id: "billing",
    label: "billing",
    category: "account",
    description: "Billing / subscription management page.",
    match: (page) => {
      const urlHit = urlMatches(page, /\/(billing|subscription|plans?|invoices?)(\/|$)/);
      const planCopy = hasAnyText(page, /(current plan|billing cycle|next invoice|cancel subscription|upgrade plan)/);
      if (urlHit && planCopy) return 0.92;
      if (urlHit) return 0.75;
      if (planCopy) return 0.7;
      return null;
    },
  },
  {
    id: "team-members",
    label: "team-members",
    category: "account",
    description: "Team / members / users admin table.",
    match: (page) => {
      const urlHit = urlMatches(page, /\/(team|members|users|organization|workspace)(\/|$)/);
      const inviteCTA = hasButton(page, /invite\s*(member|user|people|teammate)/)
        || hasLink(page, /invite/);
      if (urlHit && inviteCTA) return 0.9;
      if (urlHit) return 0.72;
      return null;
    },
  },
  {
    id: "notifications",
    label: "notifications",
    category: "account",
    description: "Notification preferences.",
    match: (page) => {
      const urlHit = urlMatches(page, /\/(notification|alerts?|emails)(\/|$)/);
      const headingHit = hasHeading(page, /notification/);
      if (urlHit && headingHit) return 0.85;
      if (urlHit) return 0.7;
      return null;
    },
  },
  {
    id: "api-keys",
    label: "api-keys",
    category: "account",
    description: "API keys / tokens management page.",
    match: (page) => {
      const urlHit = urlMatches(page, /\/(api|tokens?|keys|credentials|developers?)(\/|$)/);
      const headingHit = hasHeading(page, /(api keys?|access tokens?|personal tokens?)/);
      const createCTA = hasButton(page, /(create|new|generate)\s*(api )?(key|token)/);
      if ((urlHit || headingHit) && createCTA) return 0.92;
      if (urlHit && headingHit) return 0.85;
      return null;
    },
  },
  {
    id: "delete-account",
    label: "delete-account",
    category: "account",
    description: "Danger-zone account-deletion confirmation.",
    match: (page) => {
      const headingHit = hasHeading(page, /(delete|close|cancel).*(account|workspace)/);
      const confirm = hasButton(page, /(delete|close|cancel).*(account|workspace)/);
      const dangerText = hasAnyText(page, /(danger zone|this action (cannot|can't) be undone|permanently delete)/);
      if (headingHit && confirm && dangerText) return 0.92;
      if (headingHit && dangerText) return 0.8;
      return null;
    },
  },
];

export default rules;
