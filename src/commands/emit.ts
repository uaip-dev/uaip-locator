/**
 * `uaip-locator emit <crawl-json> [options]`
 *
 * Re-emit a Playwright TS test suite from an existing crawl.json. Useful
 * when iterating on the emitter (clear the output dir, change selectors,
 * re-emit, diff the output) or when the live site is intermittently down
 * but you have a recorded crawl.
 *
 * Reuses the same crawl→emit pipeline as `crawl` so output is byte-for-byte
 * identical given the same input crawl.json.
 */

import type { CommandModule } from "yargs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import kleur from "kleur";
import type { CrawlResult } from "../types/index.js";
import { pipelineAndWrite } from "./crawl.js";

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

    // The CrawlResult carries its own start URL on `target.url` —
    // that's the canonical place per @uaip/core. Older crawl.json
    // files may have it on a top-level field; we tolerate both.
    const startUrl =
      crawl.target?.url ??
      ((crawl as unknown as { startUrl?: string }).startUrl ?? "");
    if (!startUrl) {
      log(
        kleur.red(
          "✗ crawl.json missing target.url — was this file produced by uaip-locator?",
        ),
      );
      process.exit(1);
    }

    await pipelineAndWrite(crawl, startUrl, argv.out, log);
  },
};
