#!/usr/bin/env node
/**
 * postbuild-shebang.mjs — prepend `#!/usr/bin/env node` to dist/cli.js
 * if it's not already there, and chmod +x.
 *
 * Why this exists:
 *   • `tsc` strips the shebang line from the source — yes, even though
 *     the input has `#!/usr/bin/env node` as line 1, the compiled
 *     output starts with `import` statements directly.
 *   • npm requires `bin` scripts to start with a shebang OR the entry
 *     gets silently dropped from the published tarball (with a
 *     `script name X was invalid and removed` warning that's easy to
 *     miss in noisy CI logs). Users who `npm i -g @uaip/locator` then
 *     get no `uaip-locator` command on their PATH.
 *
 * Idempotent: safe to run on a clean build or a re-build. Runs in any
 * Node 20+ environment. Zero npm dependencies.
 */

import { readFile, writeFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, "..", "dist", "cli.js");
const SHEBANG = "#!/usr/bin/env node\n";

if (!existsSync(CLI)) {
  console.error(`✗ ${CLI} not found — did tsc run?`);
  process.exit(1);
}

const src = await readFile(CLI, "utf8");
if (src.startsWith("#!")) {
  // Already has a shebang. Nothing to do.
  console.log(`✓ shebang already present on dist/cli.js`);
} else {
  await writeFile(CLI, SHEBANG + src, "utf8");
  console.log(`✓ prepended shebang to dist/cli.js`);
}

// chmod +x is harmless on Windows (no-op) but required on POSIX so
// `npx @uaip/locator` and direct `./node_modules/.bin/uaip-locator`
// invocations work without bash wrapping.
try {
  await chmod(CLI, 0o755);
} catch {
  // Windows file-system rejects chmod; no-op there. Fine.
}
