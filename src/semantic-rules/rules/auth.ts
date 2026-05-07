/**
 * Auth category rules — login, signup, password flows.
 *
 * Load-bearing assumption: auth pages are remarkably uniform across SaaS
 * apps. A password input is a near-certain signal; the shape of the rest of
 * the form (one email box vs. one username, presence of "forgot password"
 * link, presence of "create account" CTA) disambiguates login vs. signup.
 */
import type { PageRule } from "./types.js";
import {
  countInputs,
  hasButton,
  hasHeading,
  hasInput,
  hasLink,
  urlMatches,
} from "./predicates.js";

const rules: PageRule[] = [
  {
    id: "login",
    label: "login",
    category: "auth",
    description: "Password input + one identity input (email/username), no repeat password.",
    match: (page) => {
      const password = hasInput(page, { type: "password" });
      if (!password) return null;
      const pwCount = countInputs(page, { type: "password" });
      // A signup/reset form has 2+ password inputs. Signal login by seeing
      // exactly one.
      if (pwCount !== 1) return null;
      const identity =
        hasInput(page, { type: "email" })
        || hasInput(page, { nameLike: /^(user(name)?|login|email)$/ })
        || hasInput(page, { placeholderLike: /user|email|login/ });
      const createCTA = hasLink(page, /(create account|sign ?up|register)/);
      const urlHit = urlMatches(page, /\b(login|signin|sign-in|auth)\b/);
      const headingHit = hasHeading(page, /(sign ?in|log ?in|welcome back)/);
      // Strongest case: URL + heading + identity + password.
      if (identity && (urlHit || headingHit)) return 0.95;
      if (identity && createCTA) return 0.85;
      if (identity) return 0.75;
      if (urlHit) return 0.6;
      return 0.5;
    },
  },
  {
    id: "signup",
    label: "signup",
    category: "auth",
    description: "Password + (confirm password OR heading 'sign up'/'create account').",
    match: (page) => {
      const pwCount = countInputs(page, { type: "password" });
      const confirmLike = hasInput(page, {
        nameLike: /(confirm|repeat|verify).*(pass|pw)|pass.*(confirm|again|repeat)/,
      });
      const urlHit = urlMatches(page, /\b(signup|sign-up|register|create-account|join)\b/);
      const headingHit = hasHeading(page, /(sign ?up|create (an )?account|register|get started)/);
      if (pwCount >= 2 || confirmLike) {
        if (urlHit || headingHit) return 0.95;
        return 0.85;
      }
      if (pwCount >= 1 && (urlHit || headingHit)) return 0.75;
      if (urlHit && headingHit) return 0.65;
      return null;
    },
  },
  {
    id: "password-reset",
    label: "password-reset",
    category: "auth",
    description: "Email-only form + 'reset' or 'forgot' heading/URL.",
    match: (page) => {
      const urlHit = urlMatches(page, /\b(forgot|reset|recover).*(pw|password)|password.*(forgot|reset|recover)\b/)
        || urlMatches(page, /\/(forgot|reset)(-?password)?\b/);
      const headingHit = hasHeading(page, /(forgot|reset|recover)\s*(your)?\s*password/);
      const hasEmail = hasInput(page, { type: "email" })
        || hasInput(page, { nameLike: /email/ });
      const noPw = countInputs(page, { type: "password" }) === 0;
      if ((urlHit || headingHit) && hasEmail && noPw) return 0.9;
      if (urlHit && hasEmail) return 0.7;
      return null;
    },
  },
  {
    id: "email-verify",
    label: "email-verify",
    category: "auth",
    description: "Page telling the user to check their email / confirm a code.",
    match: (page) => {
      const hit = hasHeading(page, /(verify.*email|confirm.*email|check your (email|inbox))/);
      const urlHit = urlMatches(page, /\b(verify|confirm)(-email)?\b/);
      if (hit && urlHit) return 0.9;
      if (hit) return 0.75;
      return null;
    },
  },
  {
    id: "mfa",
    label: "mfa",
    category: "auth",
    description: "2FA / one-time code entry form.",
    match: (page) => {
      const codeInput = hasInput(page, { nameLike: /^(otp|code|token|2fa)$/ })
        || hasInput(page, { placeholderLike: /(^| )(code|otp|2fa|verification)/ })
        || hasInput(page, { ariaLabelLike: /verification (code|token)|one.?time/ });
      const headingHit = hasHeading(page, /(two.?factor|2fa|verification code|authenticator)/);
      if (codeInput && headingHit) return 0.9;
      if (codeInput) return 0.65;
      if (headingHit) return 0.6;
      return null;
    },
  },
  {
    id: "sso-picker",
    label: "sso-picker",
    category: "auth",
    description: "Page offering Google/GitHub/Microsoft/SSO sign-in buttons and nothing else.",
    match: (page) => {
      const providers = [/google/, /github/, /microsoft/, /apple/, /okta/, /saml/, /sso/];
      const hits = providers.filter((re) => hasButton(page, re) || hasLink(page, re)).length;
      if (hits >= 2) return 0.85;
      if (hits >= 1 && countInputs(page) === 0) return 0.7;
      return null;
    },
  },
  {
    id: "logout-confirm",
    label: "logout-confirm",
    category: "auth",
    description: "Are-you-sure interstitial before logout.",
    match: (page) => {
      const hit = hasHeading(page, /(log ?out|sign ?out)/);
      const confirm = hasButton(page, /(yes|confirm|log ?out|sign ?out)/);
      if (hit && confirm) return 0.8;
      return null;
    },
  },
];

export default rules;
