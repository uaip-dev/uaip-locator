/**
 * Smoke test — does the package even import cleanly?
 *
 * Deliberately tiny. The OSS doesn't ship a unit-test suite for the
 * crawler / emitter / selector engine because the SaaS upstream already
 * has comprehensive offline smokes and we sync from there. What this
 * file guarantees:
 *
 *   • the public API barrel (src/index.ts) imports without throwing
 *   • the rule-based labeler returns matches against a hand-shaped
 *     fixture (catches the most likely "I broke imports" regression)
 *
 * To run live-crawl tests against real sites, see examples/ — those
 * are run-on-demand, not in CI.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";

test("public API barrel imports without throwing", async () => {
  const api = await import("../src/index.js");
  assert.equal(typeof api.crawlSite, "function");
  assert.equal(typeof api.generateAllBundles, "function");
  assert.equal(typeof api.emitPlaywrightTs, "function");
  assert.equal(typeof api.applyPageRules, "function");
  assert.equal(typeof api.buildFlowGraph, "function");
});

test("applyPageRules labels a synthetic login page", async () => {
  const { applyPageRules } = await import("../src/semantic-rules/index.js");
  const fixture = {
    url: "https://example.test/login",
    title: "Sign in",
    elements: [
      {
        uaipId: "u1",
        tag: "input",
        attributes: { type: "password", name: "password" },
        text: "",
        accessibleName: "Password",
        role: "textbox" as const,
        boundingBox: { x: 0, y: 0, width: 200, height: 32 },
        isInteractable: true,
      },
      {
        uaipId: "u2",
        tag: "button",
        attributes: { type: "submit" },
        text: "Sign in",
        accessibleName: "Sign in",
        role: "button" as const,
        boundingBox: { x: 0, y: 50, width: 100, height: 32 },
        isInteractable: true,
      },
    ],
    headings: [],
    forms: [],
  };
  // The rule registry has multiple auth-related rules (login, signup, …).
  // We just assert that *some* match comes back and that "login" is in it.
  const labels = applyPageRules(fixture as never);
  assert.ok(labels.length > 0, "expected at least one rule match");
  assert.ok(
    labels.some((l) => l.category === "login" || l.category === "auth-other"),
    `expected a login-ish category, got ${labels.map((l) => l.category).join(",")}`,
  );
});
