#!/usr/bin/env node
/**
 * sync-from-monorepo.mjs — copy + rewrite source files from the closed-source
 * UAIP monorepo into this OSS repo, transforming `@uaip/*` workspace imports
 * into relative paths.
 *
 * Why this script exists:
 *   • The OSS repo lives in its own GitHub repo and ships as a single npm
 *     package. It can't `import "@uaip/core"` because that name only resolves
 *     inside the SaaS pnpm workspace.
 *   • This script gives us a deterministic way to refresh the OSS source
 *     from the monorepo when the founder cherry-picks selector-engine or
 *     emitter improvements upstream. Run it, review the diff, commit.
 *   • Standalone-fork model (per spin-out plan): copies are one-shot,
 *     not a build step. The OSS repo stays a regular npm package — no
 *     hidden generation magic for contributors to learn.
 *
 * Usage:
 *   node scripts/sync-from-monorepo.mjs
 *   node scripts/sync-from-monorepo.mjs --monorepo /path/to/uaip
 *
 * After running:
 *   • git diff to review what changed
 *   • npm test to confirm nothing broke
 *   • commit with a message like "sync: pull selector-engine fixes from monorepo @ <commit>"
 */

import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { argv, exit } from "node:process";
import { glob } from "node:fs/promises";

// ── locate monorepo ────────────────────────────────────────────────────
const argMonorepo = argv.find((a) => a.startsWith("--monorepo="))?.split("=")[1];
// fileURLToPath handles URL-encoded characters (spaces in the project folder
// name show up as %20 in import.meta.url and break path.resolve).
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const monorepoRoot = argMonorepo
  ? resolve(argMonorepo)
  : resolve(repoRoot, "..", "uaip");

if (!existsSync(monorepoRoot)) {
  console.error(`✗ monorepo not found at ${monorepoRoot}`);
  console.error(`  pass --monorepo=<path> if it lives elsewhere`);
  exit(2);
}
console.log(`monorepo: ${monorepoRoot}`);
console.log(`oss-repo: ${repoRoot}`);

// ── what to copy where ─────────────────────────────────────────────────
// Each entry: [source-dir-relative-to-monorepo, dest-dir-relative-to-oss-repo]
// Files are copied recursively. Skip globs are file basenames.
const COPY_PLAN = [
  // The shared types — `@uaip/core` in the monorepo, just "types" here.
  {
    from: "packages/core/src",
    to: "src/types",
    skip: [],
  },
  // Selector engine — verbatim, this IS the OSS value prop.
  {
    from: "packages/selector-engine/src",
    to: "src/selector-engine",
    skip: [],
  },
  // Playwright TS emitter — verbatim, including the recent .or() filter fix.
  {
    from: "packages/codegen-playwright-ts/src",
    to: "src/codegen",
    skip: [],
  },
  // Crawler — copy all. The CLI just doesn't expose --auth or storage; the
  // plumbing stays so a future contributor could re-enable it.
  {
    from: "packages/crawler/src",
    to: "src/crawler",
    skip: [],
  },
  // Semantic — RULES ONLY. The LLM/embeddings/Ollama paths stay in the SaaS.
  // We grab the rules/* dir and the parent semantic/types.ts which the
  // rules import for shared types.
  {
    from: "packages/semantic/src/rules",
    to: "src/semantic-rules/rules",
    skip: [],
  },
  // Flow graph — verbatim.
  {
    from: "packages/flow-graph/src",
    to: "src/flow-graph",
    skip: [],
  },
];

// Files to copy individually (not whole dirs).
const COPY_FILES = [
  // The semantic types module the rules import. Lifted up one level so
  // src/semantic-rules/types.ts is the canonical location.
  {
    from: "packages/semantic/src/types.ts",
    to: "src/semantic-rules/types.ts",
  },
];

// ── import rewrites ────────────────────────────────────────────────────
// Map @uaip/* package names to OSS-internal paths AS A DIRECTORY UNDER src/.
// The actual relative path emitted into the source file depends on how
// deep the importing file lives below src/ — see toRelative() below.
const IMPORT_TARGETS = {
  "@uaip/core": "types",
  "@uaip/selector-engine": "selector-engine",
  "@uaip/codegen-playwright-ts": "codegen",
  "@uaip/crawler": "crawler",
  "@uaip/semantic": "semantic-rules",
  "@uaip/flow-graph": "flow-graph",
};

/**
 * Compute "../" prefix needed to reach src/ from a file at `destPath`.
 * E.g. src/codegen/emit.ts → "../" (one ../ to get to src/), and
 *      src/semantic-rules/rules/account.ts → "../../" (two ../).
 */
function srcRelativePrefix(destPath, repoRoot) {
  const fromSrc = relative(join(repoRoot, "src"), destPath);
  const depth = fromSrc.split(/[/\\]/).length - 1; // -1 because the file itself doesn't count
  return "../".repeat(depth);
}

/** Rewrite a single source file's `@uaip/*` imports + write to dest. */
async function rewriteAndWrite(srcPath, destPath) {
  let src = await readFile(srcPath, "utf8");
  const prefix = srcRelativePrefix(destPath, repoRoot);
  // Match: import ... from "@uaip/foo"  OR  from "@uaip/foo/bar"
  src = src.replace(
    /from\s+(["'])(@uaip\/[a-z-]+)(\/[^"']*)?\1/g,
    (_, q, pkg, rest) => {
      const targetDir = IMPORT_TARGETS[pkg];
      if (!targetDir) {
        // Unknown @uaip/* package — bail loud rather than silently smuggle
        // a broken import into the OSS bundle.
        throw new Error(`unmapped import "${pkg}" in ${srcPath}`);
      }
      // E.g. depth=2 (rules subdir) → "../../selector-engine/index.js"
      return `from ${q}${prefix}${targetDir}/index.js${rest ?? ""}${q}`;
    },
  );
  await mkdir(dirname(destPath), { recursive: true });
  await writeFile(destPath, src, "utf8");
}

// ── execute ────────────────────────────────────────────────────────────
let copiedFiles = 0;

for (const plan of COPY_PLAN) {
  const fromAbs = resolve(monorepoRoot, plan.from);
  const toAbs = resolve(repoRoot, plan.to);
  if (!existsSync(fromAbs)) {
    console.warn(`  skip: ${plan.from} not present in monorepo`);
    continue;
  }
  // Wipe the dest before copy so deletions in the monorepo are reflected.
  // Tolerated to fail (some sandboxes prohibit rmdir even on empty dirs);
  // overwriting the *.ts files below is sufficient for incremental syncs.
  if (existsSync(toAbs)) {
    try {
      await rm(toAbs, { recursive: true, force: true });
    } catch (err) {
      console.warn(`  warn: could not wipe ${plan.to} (${err.code}); overwriting in place`);
    }
  }
  // Walk the source tree.
  for await (const entry of glob("**/*.ts", { cwd: fromAbs })) {
    if (plan.skip.includes(entry)) continue;
    const srcPath = join(fromAbs, entry);
    const destPath = join(toAbs, entry);
    await rewriteAndWrite(srcPath, destPath);
    copiedFiles++;
  }
  console.log(`  ✓ ${plan.from} → ${plan.to}`);
}

for (const f of COPY_FILES) {
  const fromAbs = resolve(monorepoRoot, f.from);
  const toAbs = resolve(repoRoot, f.to);
  if (!existsSync(fromAbs)) {
    console.warn(`  skip: ${f.from} not present`);
    continue;
  }
  await rewriteAndWrite(fromAbs, toAbs);
  copiedFiles++;
  console.log(`  ✓ ${f.from} → ${f.to}`);
}

console.log(`\n${copiedFiles} files synced.`);
console.log(`next: review with \`git diff\`, then \`npm test\`.`);
