/**
 * `uaip-locator emit <crawl-json> [options]`
 *
 * Re-emit a Playwright TS test suite from an existing crawl.json without
 * re-crawling the live site. Useful when:
 *   • iterating on the emitter (clear the output dir, change selectors,
 *     re-emit, diff the output)
 *   • the live site is intermittently down but you have a recorded crawl
 *   • you want deterministic test-output for snapshot tests
 *
 * The crawl.json file is the same one `crawl` writes to the output dir.
 */

import type { CommandModule } from "yargs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import kleur from "kleur";
import { generateAllBundles } from "../selector-engine/index.js";
import { applyPageRules } from "../semantic-rules/index.js";
import { buildFlowGraph, findJourneys } from "../flow-graph/index.js";
import { emitPlaywrightTs } from "../codegen/index.js";
import type { CrawlResult, PageLabel } from "../types/index.js";

interface EmitArgs {
  crawlJson: string;
  out: string;
}

export const emitCommand: CommandModule<unknown, EmitArgs> = {
  command: "emit <crawlJson>",
  describe: "Re-emit tests from a saved crawl.json (offline, fast)",
  builder: (y) =>
    y
      .positional("crawlJson", {
        type: "string",
        describe: "Path to a crawl.json file produced by `uaip-locator crawl`",
        demandOption: true,
      })
      .option("out", {
        type: "string",
        describe: "Output directory for the re-emitted suite",
        default: "./uaip-tests",
      })
      .example(
        "$0 emit ./tests/crawl.json --out ./tests-fresh",
        "Re-emit into a sibling folder so you can diff the output",
      ) as unknown as import("yargs").Argv<EmitArgs>,
  handler: async (argv) => {
    const log = (msg: string) => {
      // eslint-disable-next-line no-console
      console.log(msg);
    };

    const crawlPath = resolve(argv.crawlJson);
    log(kleur.bold("→ reading ") + kleur.underline(crawlPath));
    const crawl = JSON.parse(await readFile(crawlPath, "utf8")) as CrawlResult;
    if (!crawl.pages || crawl.pages.length === 0) {
      log(kleur.red("✗ crawl.json has no pages — emit would produce nothing"));
      process.exit(1);
    }

    const bundles = generateAllBundles(crawl);
    const labelsByUrl = new Map<string, PageLabel[]>();
    for (const page of crawl.pages) labelsByUrl.set(page.url, applyPageRules(page));
    const graph = buildFlowGraph(crawl, { labelsByUrl });
    const journeys = findJourneys(graph, { maxJourneys: 8 });

    const baseName = deriveBaseName(crawl.startUrl);
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
    const emit = emitPlaywrightTs(codegenInput as Parameters<typeof emitPlaywrightTs>[0], bundles);

    const outDir = resolve(argv.out);
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "crawl.json"), JSON.stringify(crawl, null, 2), "utf8");
    for (const [name, content] of Object.entries(emit.files)) {
      const dest = join(outDir, name);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, content, "utf8");
    }
    log(kleur.green(kleur.bold("✓ done")));
    log(kleur.dim("  out: ") + outDir);
    log(
      kleur.dim("  files: ") +
        Object.keys(emit.files).slice(0, 6).join(", ") +
        (Object.keys(emit.files).length > 6 ? "…" : ""),
    );
  },
};

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
    return basename(url);
  }
}
