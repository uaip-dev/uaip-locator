/**
 * `uaip-locator crawl <url> [options]`
 *
 * Walks a public website same-origin, builds a flow graph, picks a
 * minimal smoke scenario from each discovered journey, generates a
 * Playwright TS test suite into the output folder.
 *
 * Versus the SaaS CLI command at apps/cli/src/commands/crawl.ts:
 *   • no project resolution / billing gate / API client
 *   • no `--auth` / `--remember-auth` / storageState plumbing
 *   • no `--emit <framework>` flag — Playwright TS is the only path
 *   • no `--semantic`/--llm — rule-based labeling is unconditional
 *   • simpler scenario synthesis: one smoke scenario per detected
 *     journey, no detect-login-form heuristic. The SaaS does richer
 *     multi-step synthesis; the OSS keeps it deliberately small so
 *     users have a reason to upgrade for more sophisticated coverage.
 */

import type { CommandModule } from "yargs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import kleur from "kleur";
import { crawlSite } from "../crawler/index.js";
import { generateAllBundles } from "../selector-engine/index.js";
import { applyPageRules } from "../semantic-rules/index.js";
import { buildFlowGraph, findJourneys } from "../flow-graph/index.js";
import { emitPlaywrightTs } from "../codegen/index.js";
import type {
  CrawlResult,
  PageLabel,
  PageSnapshot,
  TestAction,
  TestScenario,
  UiElement,
  Journey,
  CodegenInput,
} from "../types/index.js";

interface CrawlArgs {
  url: string;
  out: string;
  maxPages: number;
  maxDepth: number | undefined;
  headed: boolean;
  scopePrefix?: string;
  exclude?: string[];
}

export const crawlCommand: CommandModule<unknown, CrawlArgs> = {
  command: "crawl <url>",
  describe: "Crawl a public website and generate a Playwright TS test suite",
  builder: (y) =>
    y
      .positional("url", {
        type: "string",
        describe: "Starting URL — must be http(s) and reachable without auth",
        demandOption: true,
      })
      .option("out", {
        type: "string",
        describe: "Output directory for the generated test suite",
        default: "./uaip-tests",
      })
      .option("max-pages", {
        type: "number",
        describe: "Maximum number of pages to visit",
        default: 50,
      })
      .option("max-depth", {
        type: "number",
        describe: "Maximum link-depth from the starting URL (no limit if unset)",
      })
      .option("headed", {
        type: "boolean",
        describe: "Open a real browser window so you can watch the crawl",
        default: false,
      })
      .option("scope-prefix", {
        type: "string",
        describe: "Restrict the crawl to URLs whose path starts with this prefix",
      })
      .option("exclude", {
        type: "array",
        string: true,
        describe: "Glob patterns to exclude from crawling (repeatable)",
      })
      .example(
        "$0 crawl https://saucedemo.com --out ./tests",
        "Crawl + emit a full Playwright TS suite into ./tests",
      )
      .example(
        "$0 crawl https://example.com --max-pages 10 --headed",
        "Quick 10-page exploratory crawl with a visible browser",
      ) as unknown as import("yargs").Argv<CrawlArgs>,
  handler: async (argv) => {
    const log = (msg: string) => {
      // eslint-disable-next-line no-console
      console.log(msg);
    };

    log(kleur.bold("→ crawling ") + kleur.underline(argv.url));
    log(
      kleur.dim(
        `  max-pages=${argv.maxPages}` +
          (argv.maxDepth !== undefined ? ` max-depth=${argv.maxDepth}` : "") +
          (argv.headed ? " (headed)" : "") +
          (argv.scopePrefix ? ` scope-prefix=${argv.scopePrefix}` : ""),
      ),
    );

    // 1. CRAWL
    const crawl: CrawlResult = await crawlSite({
      url: argv.url,
      headed: argv.headed,
      maxPages: argv.maxPages,
      ...(argv.maxDepth !== undefined ? { maxDepth: argv.maxDepth } : {}),
      scope: {
        sameOrigin: true,
        ...(argv.scopePrefix ? { pathPrefix: argv.scopePrefix } : {}),
        ...(argv.exclude ? { exclude: argv.exclude } : {}),
      },
      onPageVisited: (snap, depth, visited) => {
        log(
          kleur.dim(`  · [${visited}/${argv.maxPages}] depth ${depth} → `) +
            kleur.dim(snap.url) +
            kleur.dim(` (${snap.elements.length} elements)`),
        );
      },
      onPageFailed: (failedUrl, reason) => {
        log(kleur.yellow("  · failed: ") + failedUrl + kleur.dim(" — " + reason));
      },
    });

    if (crawl.pages.length === 0) {
      log(kleur.red("✗ no pages crawled — check the URL is reachable"));
      process.exit(1);
    }

    await pipelineAndWrite(crawl, argv.url, argv.out, log);
  },
};

/**
 * Shared crawl→emit pipeline used by both `crawl` and `emit`. Computes
 * selectors, page labels, flow graph, scenarios, then writes the suite
 * to disk. Extracted so re-emitting from a saved crawl.json takes the
 * exact same code path as a fresh crawl.
 */
export async function pipelineAndWrite(
  crawl: CrawlResult,
  startUrl: string,
  outDir: string,
  log: (msg: string) => void,
): Promise<void> {
  // 2. SELECTOR BUNDLES — flat across all pages, keyed by uaipId.
  //    Two pages' identical elements (e.g. shared header) collapse to
  //    one bundle, which is what we want.
  const allElements: UiElement[] = crawl.pages.flatMap((p) => p.elements);
  const bundles = generateAllBundles(allElements);
  // Mutate crawl in place — emitters read crawl.selectors when present.
  crawl.selectors = bundles;

  // 3. RULE-BASED PAGE LABELS — keyed by URL. The OSS does not include
  //    the LLM/embeddings fallback; rules only.
  const pageLabels: Record<string, PageLabel[]> = {};
  for (const page of crawl.pages) {
    const labels = applyPageRules(page);
    if (labels.length > 0) pageLabels[page.url] = labels;
  }
  crawl.pageLabels = pageLabels;

  // 4. FLOW GRAPH + JOURNEY DISCOVERY. fallbackUrlLabels: true keeps
  //    rule-unmatched pages in the graph (labelled from URL path) so
  //    sites whose vocabulary isn't in our rule registry still produce
  //    a useful graph.
  const graph = buildFlowGraph(crawl, { fallbackUrlLabels: true });
  const journeys = findJourneys(graph);
  log(
    kleur.dim(
      `  flow graph: ${graph.nodes.length} nodes / ${graph.edges.length} edges · ${journeys.length} journeys`,
    ),
  );

  // 5. SCENARIO SYNTHESIS — minimal. One smoke scenario per journey,
  //    each visiting the journey's pages and asserting that a few
  //    high-confidence visible elements exist. The SaaS does richer
  //    journey-shaped scenarios with click/fill sequences; the OSS
  //    deliberately ships a smaller surface.
  const scenarios = journeys.length > 0
    ? journeys.slice(0, 5).map((j, i) => synthesiseSmokeFromJourney(j, crawl.pages, i))
    : [synthesiseTopLevelSmoke(startUrl, crawl.pages)];

  // 6. CODEGEN
  const baseName = deriveBaseName(startUrl);
  const codegenInput: CodegenInput = {
    baseName,
    baseUrl: startUrl,
    scenarios,
    ...(Object.keys(pageLabels).length > 0 ? { pageLabels } : {}),
  };
  const emit = emitPlaywrightTs(codegenInput, bundles);

  // 7. WRITE TO DISK
  const absOut = resolve(outDir);
  await mkdir(absOut, { recursive: true });
  await writeFile(join(absOut, "crawl.json"), JSON.stringify(crawl, null, 2), "utf8");
  await writeFile(
    join(absOut, "uaip-manifest.json"),
    JSON.stringify(
      {
        tool: "uaip-locator",
        version: readPackageVersion(),
        framework: "playwright-ts",
        crawlId: basename(absOut),
        host: hostOf(startUrl),
        startUrl,
        pageCount: crawl.pages.length,
        journeyCount: journeys.length,
        emittedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );
  for (const [name, content] of Object.entries(emit.files)) {
    const dest = join(absOut, name);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, content, "utf8");
  }

  log(kleur.green(kleur.bold("✓ done")));
  log(kleur.dim("  out:    ") + absOut);
  log(
    kleur.dim("  files:  ") +
      Object.keys(emit.files).slice(0, 6).join(", ") +
      (Object.keys(emit.files).length > 6 ? "…" : ""),
  );
  log("");
  log(
    kleur.dim("  next:   ") +
      kleur.bold(
        `cd ${outDir} && npm i && npx playwright install chromium && npx playwright test`,
      ),
  );
}

/**
 * Build a smoke scenario from a discovered journey. Visits each URL the
 * journey passes through and asserts a couple of interactable elements
 * are visible. Doesn't try to drive forms or click through — that's
 * where the SaaS multi-journey synthesis lives.
 *
 * Note: per @uaip/core, `Journey.nodes` is `string[]` (the URLs of the
 * traversed pages) and `Journey.labels` is the parallel array of
 * label-id strings. `Journey.name` is already PascalCased — we reuse it.
 */
function synthesiseSmokeFromJourney(
  journey: Journey,
  pages: PageSnapshot[],
  index: number,
): TestScenario {
  const pagesByUrl = new Map(pages.map((p) => [p.url, p]));
  const actions: TestAction[] = [];
  const visitedUrls: string[] = [];
  for (const url of journey.nodes) {
    const page = pagesByUrl.get(url);
    if (!page) continue;
    actions.push({ kind: "navigate", url, comment: `Visit ${url}` });
    visitedUrls.push(url);
    // Pick up to 2 interactable elements with high-signal accessibility
    // info to assert visible. Filters: must be interactable, must have a
    // useful name (so the assertion has a real target).
    const candidates = page.elements
      .filter((el) => el.isInteractable && (el.accessibleName || el.text).trim().length > 0)
      .slice(0, 2);
    for (const el of candidates) {
      actions.push({
        kind: "expectVisible",
        targetUaipId: el.uaipId,
        comment: `${el.tag} "${(el.accessibleName || el.text).slice(0, 40)}" visible`,
      });
    }
  }
  const baseName = journey.name && journey.name.length > 0
    ? journey.name.replace(/Journey$/, "")
    : `Journey${index + 1}`;
  return {
    name: `${baseName}Smoke`,
    description: `Smoke walk of ${visitedUrls.length} page(s) — journey: ${journey.nodes.join(" → ")}`,
    actions,
  };
}

/**
 * Fallback when no journeys were found: visit the start URL, assert a
 * couple of visible elements. Always produces something testable.
 */
function synthesiseTopLevelSmoke(
  startUrl: string,
  pages: PageSnapshot[],
): TestScenario {
  const start = pages[0];
  const actions: TestAction[] = [
    { kind: "navigate", url: startUrl, comment: `Visit ${startUrl}` },
  ];
  if (start) {
    const candidates = start.elements
      .filter((el) => el.isInteractable && (el.accessibleName || el.text).trim().length > 0)
      .slice(0, 3);
    for (const el of candidates) {
      actions.push({
        kind: "expectVisible",
        targetUaipId: el.uaipId,
        comment: `${el.tag} "${(el.accessibleName || el.text).slice(0, 40)}" visible`,
      });
    }
  }
  return {
    name: "Smoke",
    description: `Visit ${startUrl} and confirm key elements render`,
    actions,
  };
}

/**
 * Pick a sensible test-class base name from the URL host. saucedemo.com →
 * SaucedemoCom; my-site.example → MySiteExample.
 */
function deriveBaseName(url: string): string {
  try {
    const host = new URL(url).host.replace(/^www\./, "");
    return host
      .split(/[.-]/)
      .filter(Boolean)
      .map((s) => s[0]!.toUpperCase() + s.slice(1).toLowerCase())
      .join("")
      .replace(/[^A-Za-z0-9]/g, "");
  } catch {
    return "Site";
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/**
 * Read our own version from package.json — used for the manifest. We
 * use createRequire so the file resolves at runtime in both ESM and
 * the compiled output.
 */
function readPackageVersion(): string {
  try {
    const { createRequire } = require("node:module") as typeof import("node:module");
    const req = createRequire(import.meta.url);
    const pkg = req("../../package.json") as { version: string };
    return pkg.version;
  } catch {
    return "unknown";
  }
}
