/**
 * @uaip/flow-graph — turns a labelled crawl into a ranked list of test
 * journeys.
 *
 * Public surface is deliberately small:
 *   - buildFlowGraph(CrawlResult)  → FlowGraph
 *   - findJourneys(graph, opts)    → Journey[] (scored + sorted)
 *   - journeyName(labels)          → string  (exported for tests + codegen)
 *   - scoreJourney(labels, cats)   → number  (exported for dashboard tooltips)
 *
 * Types (FlowNode, FlowEdge, FlowGraph, Journey) live in @uaip/core so
 * CrawlResult can reference them without creating a core → flow-graph
 * dependency cycle.
 */
export { buildFlowGraph, adjacency } from "./build.js";
export type { BuildFlowGraphOptions } from "./build.js";
export { findJourneys, journeyName } from "./journeys.js";
export type { FindJourneysOptions } from "./journeys.js";
export {
  scoreJourney,
  TERMINAL_LABELS,
  STARTING_LABELS,
  CATEGORY_WEIGHTS,
  CATEGORY_HIT_MULTIPLIER,
  TERMINAL_BONUS,
  STARTING_BONUS,
  PATH_LENGTH_PENALTY,
} from "./scoring.js";
