/**
 * `uaip-locator doctor`
 *
 * Pre-flight: verify the host environment is ready for a crawl. Checks:
 *   1. Node version >= 20
 *   2. `playwright` package installed (transitive — if our deps did their
 *      job, this is always true)
 *   3. Chromium binary available — we look for it via Playwright's own
 *      `chromium.executablePath()` rather than relying on $PATH; that
 *      mirrors what the real crawl will do and catches the most common
 *      first-run mistake (forgot `npx playwright install chromium`).
 *
 * Returns exit code 0 when all green, 1 when any check fails. Designed
 * to be runnable inside CI as a sanity step before the actual crawl.
 */

import type { CommandModule } from "yargs";
import { existsSync } from "node:fs";
import kleur from "kleur";

interface DoctorArgs {}

export const doctorCommand: CommandModule<unknown, DoctorArgs> = {
  command: "doctor",
  describe: "Verify the host environment is ready for a crawl",
  builder: (y) => y as unknown as import("yargs").Argv<DoctorArgs>,
  handler: async () => {
    const log = (msg: string) => {
      // eslint-disable-next-line no-console
      console.log(msg);
    };
    let failures = 0;

    // ── Node ──
    const nodeMajor = Number((process.versions.node ?? "").split(".")[0] ?? "0");
    if (nodeMajor >= 20) {
      log(kleur.green("✓ ") + `Node ${process.versions.node}`);
    } else {
      log(kleur.red("✗ ") + `Node ${process.versions.node} — need >=20`);
      failures++;
    }

    // ── playwright module ──
    let chromiumPath: string | null = null;
    try {
      const pw = await import("playwright");
      log(kleur.green("✓ ") + "playwright module available");
      try {
        chromiumPath = pw.chromium.executablePath();
      } catch {
        // No browsers installed → executablePath throws.
        chromiumPath = null;
      }
    } catch (err) {
      log(
        kleur.red("✗ ") +
          "playwright module not installable: " +
          (err instanceof Error ? err.message : String(err)),
      );
      failures++;
    }

    // ── Chromium binary ──
    if (chromiumPath && existsSync(chromiumPath)) {
      log(kleur.green("✓ ") + `Chromium installed at ${chromiumPath}`);
    } else {
      log(
        kleur.yellow("✗ ") +
          "Chromium binary missing — run: " +
          kleur.bold("npx playwright install chromium"),
      );
      failures++;
    }

    // ── Write permission in cwd ──
    try {
      const { mkdtempSync, rmSync } = await import("node:fs");
      const { join } = await import("node:path");
      const probe = mkdtempSync(join(process.cwd(), ".uaip-locator-probe-"));
      rmSync(probe, { recursive: true, force: true });
      log(kleur.green("✓ ") + "writable cwd");
    } catch (err) {
      log(
        kleur.red("✗ ") +
          "cannot create files in cwd: " +
          (err instanceof Error ? err.message : String(err)),
      );
      failures++;
    }

    log("");
    if (failures === 0) {
      log(kleur.green(kleur.bold("all checks passed")));
      process.exit(0);
    } else {
      log(kleur.red(kleur.bold(`${failures} check(s) failed`)));
      process.exit(1);
    }
  },
};
