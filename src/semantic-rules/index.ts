/**
 * Re-export the rule registry + runner from the rules/ subdir so callers
 * can `import { primaryLabel, applyPageRules } from "../semantic-rules/index.js"`
 * without knowing the internal nesting.
 *
 * The OSS build deliberately omits the LLM-backed labeler and embedding
 * classifier that ship in the closed-source SaaS (`@uaip/semantic` proper).
 * Rules are good enough for ~80% of pages and run in <5ms each, no
 * network dependency, no API key — exactly what an OSS user expects.
 */
export {
  ALL_RULES,
  MIN_CONFIDENCE,
  applyPageRules,
  primaryLabel,
} from "./rules/index.js";

export type { PageRule } from "./rules/types.js";
