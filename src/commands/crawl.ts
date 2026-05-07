/**
 * `uaip-locator crawl <url> [options]`
 *
 * The headline command. Walks a public website same-origin, builds a flow
 * graph, picks high-value journeys, generates a Playwright TS test suite
 * into the output folder.
 *
 * Trimmed-down version of the SaaS CLI's crawl command:
 *   • no project resolution / billing gate / API client
 *   • no `--auth` / `--remember-auth` / storageState plumbing surfaced
 *   • no `--emit <framework>` flag — Playwright TS is the only path
 *   • no `--semantic`/--llm — rule-based labeling is unconditional
 *   • no telemetry, no API key
 */

import type { CommandModule } from "yargs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import kleur from "kleur";
import { crawlSite } from "../crawler/index.js";
import {
  generateAllBundles,
} from "../selector-engine/index.js";
import { applyPageRules } from "../semantic-rules/index.js";
import { buildFlowGraph, findJourneys } from "../flow-graph/index.js";
import { emitPlaywrightTs } from "../codegen/index.js";
import type { CrawlResult, PageLabel } from "../types/index.js";

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

    // 2. SELECTOR BUNDLES (per element across all pages)
    const bundles = generateAllBundles(crawl);

    // 3. RULE-BASED PAGE LABELS
    const labelsByUrl = new Map<string, PageLabel[]>();
    for (const page of crawl.pages) {
      labelsByUrl.set(page.url, applyPageRules(page));
    }

    // 4. FLOW GRAPH + JOURNEY DISCOVERY
    const graph = buildFlowGraph(crawl, { labelsByUrl });
    const journeys = findJourneys(graph, { maxJourneys: 8 });
    log(
      kleur.dim(`  flow graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges`) +
        kleur.dim(`  · ${journeys.length} journeys discovered`),
    );

    // 5. CODEGEN
    const baseName = deriveBaseName(argv.url);
    const codegenInput = {
      baseName,
      ...crawl,
      pages: crawl.pages.map((p) => ({
        ...p,
        labels: labelsByUrl.get(p.url) ?? [],
      })),
      journeys,
      graph,
    };
    // The emitter expects the SaaS-shaped CodegenInput; cast since the OSS
    // doesn't carry semanticLabels (LLM-only) or auth (excluded from OSS).
    const emit = emitPlaywrightTs(codegenInput as Parameters<typeof emitPlaywrightTs>[0], bundles);

    // 6. WRITE TO DISK
    const outDir = resolve(argv.out);
    await mkdir(outDir, { recursive: true });
    await writeFile(
      join(outDir, "crawl.json"),
      JSON.stringify(crawl, null, 2),
      "utf8",
    );
    // OSS manifest — same shape the SaaS uses, identifies the producer.
    await writeFile(
      join(outDir, "uaip-manifest.json"),
      JSON.stringify(
        {
          tool: "uaip-locator",
          version: readPackageVersion(),
          framework: "playwright-ts",
          crawlId: basename(outDir),
          host: hostOf(argv.url),
          startUrl: argv.url,
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
      const dest = join(outDir, name);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, content, "utf8");
    }

    log(kleur.green(kleur.bold("✓ done")));
    log(kleur.dim("  out:    ") + outDir);
    log(
      kleur.dim("  files:  ") +
        Object.keys(emit.files).slice(0, 6).join(", ") +
        (Object.keys(emit.files).length > 6 ? "…" : ""),
    );
    log("");
    log(
      kleur.dim("  next:   ") +
        kleur.bold(
          `cd ${argv.out} && npm i && npx playwright install chromium && npx playwright test`,
        ),
    );
  },
};

/**
 * Pick a sensible test-class base name from the URL host. saucedemo.com →
 * SaucedemoCom; my-site.example → MySiteExample. Used as the SmokeTest
 * class prefix in emitted code.
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
 * Read our own version from package.json — used for the manifest. We do
 * the simplest thing that works in both `tsx src/cli.ts` (dev) and the
 * compiled bundle (`dist/cli.js`).
 */
function readPackageVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const pkg = require("../../package.json") as { version: string };
    return pkg.version;
  } catch {
    return "unknown";
  }
}
