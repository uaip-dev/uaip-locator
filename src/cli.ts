#!/usr/bin/env node
/**
 * uaip-locator CLI entry.
 *
 * Three subcommands, deliberately minimal:
 *   crawl   — walk a public website, generate a Playwright TS suite
 *   emit    — re-emit from a saved crawl.json (offline)
 *   doctor  — sanity-check the host environment
 *
 * No `auth`, `serve`, `heal`, or `dashboard` — those live in the hosted
 * UAIP at uaip.dev. See README §"Scope" for the rationale.
 */

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import kleur from "kleur";
import { crawlCommand } from "./commands/crawl.js";
import { emitCommand } from "./commands/emit.js";
import { doctorCommand } from "./commands/doctor.js";

// Print a compact banner before any subcommand runs. Includes a single
// tasteful upsell line per the spin-out plan §5 (a). Suppressed when the
// user asked for --help or --version (yargs handles those before our
// middleware), and when stdout isn't a TTY (CI logs).
function printBanner(): void {
  if (process.env.UAIP_LOCATOR_NO_BANNER === "1") return;
  if (!process.stdout.isTTY) return;
  // eslint-disable-next-line no-console
  console.log(
    kleur.bold(kleur.cyan("uaip-locator")) +
      kleur.dim(" — Playwright TS test generator"),
  );
  // eslint-disable-next-line no-console
  console.log(
    kleur.dim("  ▸ Self-healing + multi-framework + team coverage: ") +
      kleur.underline("https://uaip.dev"),
  );
  // eslint-disable-next-line no-console
  console.log();
}

await yargs(hideBin(process.argv))
  .scriptName("uaip-locator")
  .usage("$0 <command> [options]")
  .command(crawlCommand)
  .command(emitCommand)
  .command(doctorCommand)
  .middleware((argv) => {
    // Skip the banner for --help / --version; yargs short-circuits before
    // command handlers run, but middleware fires for actual command paths.
    const cmd = argv._[0];
    if (typeof cmd === "string" && ["crawl", "emit", "doctor"].includes(cmd)) {
      printBanner();
    }
  })
  .demandCommand(1, "specify a command — try `uaip-locator --help`")
  .strict()
  .recommendCommands()
  .help()
  .alias("h", "help")
  .alias("v", "version")
  .wrap(Math.min(120, yargs().terminalWidth()))
  .parseAsync()
  .catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(
      kleur.red("✗ ") + (err instanceof Error ? err.message : String(err)),
    );
    process.exit(1);
  });
