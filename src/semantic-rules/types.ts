/**
 * Placeholder.
 *
 * The closed-source SaaS has a `@uaip/semantic` package that includes
 * LLM-backed labelers + Ollama types. The OSS spin-out deliberately
 * omits that path — rule-based labeling is sufficient for the OSS use
 * case and keeps the install zero-config.
 *
 * The actual rule types live at `./rules/types.ts` and are exported via
 * `./index.ts`. This file exists only because the sync script pulls
 * `packages/semantic/src/types.ts` from the monorepo as a convenience
 * for any downstream consumer that imports from "../semantic-rules"
 * expecting the SaaS-shaped barrel.
 *
 * Safe to delete on disk; kept empty so the next `scripts/sync-from-monorepo.mjs`
 * run has a deterministic place to land the file.
 */
export {};
