/**
 * Find and rank journeys (simple paths) through a FlowGraph.
 *
 * Algorithm:
 *   1. Enumerate every simple path up to `maxLen` via DFS.
 *   2. Score each path via `scoring.ts`.
 *   3. De-duplicate paths that share the same (start, end, label-set)
 *      signature — this collapses near-identical routes and keeps the
 *      output list useful to humans.
 *   4. Sort by score desc and return the top `limit`.
 *
 * Why enumerate rather than Dijkstra/BFS? We care about full *paths*,
 * not just reachability, and we want to score each path with a function
 * that depends on every node visited. Real crawls in our scope (≤25
 * pages) produce tiny graphs; full DFS with a length cap is fine and
 * keeps the code trivially inspectable.
 *
 * Naming:
 *   Journeys are named after their first and last labels ("login" +
 *   "order-confirm" → `loginToOrderConfirmJourney`). Intermediate labels
 *   are deliberately omitted — names blow up in length otherwise and the
 *   start+end pair is what a human reader remembers anyway.
 */
import type { FlowGraph, Journey, PageCategory } from "../types/index.js";
import { adjacency } from "./build.js";
import { scoreJourney } from "./scoring.js";

export interface FindJourneysOptions {
  /** Maximum number of nodes in any journey. Defaults to 8. */
  maxLen?: number;
  /** Maximum journeys returned. Defaults to 10. */
  limit?: number;
  /**
   * Minimum score required. Defaults to 0.5 — enough to filter out
   * single-node "journeys" in low-signal categories.
   */
  minScore?: number;
}

/**
 * Find ranked journeys through the graph. Always returns an array — empty
 * if no path met the threshold.
 */
export function findJourneys(
  graph: FlowGraph,
  opts: FindJourneysOptions = {},
): Journey[] {
  const maxLen = opts.maxLen ?? 8;
  const limit = opts.limit ?? 10;
  const minScore = opts.minScore ?? 0.5;

  if (graph.nodes.length === 0) return [];

  const nodeByUrl = new Map(graph.nodes.map((n) => [n.url, n]));
  const adj = adjacency(graph);

  const candidates: Journey[] = [];

  // DFS from every node. Total work is O(nodes * branches^maxLen); with
  // maxLen=8 and the typical ≤25-node crawl that's well under 100k paths
  // in practice — trivial to enumerate in-memory.
  for (const start of graph.nodes) {
    dfs({
      start: start.url,
      current: start.url,
      path: [start.url],
      visited: new Set([start.url]),
      adj,
      maxLen,
      onPath: (path) => {
        const labels = path.map((u) => nodeByUrl.get(u)?.label ?? "");
        const categories = path
          .map((u) => nodeByUrl.get(u)?.category)
          .filter((c): c is PageCategory => c !== undefined);
        const score = scoreJourney(labels, categories);
        if (score < minScore) return;
        candidates.push({
          nodes: [...path],
          labels,
          score,
          name: journeyName(labels),
        });
      },
    });

    // Also include the single-node "journey" — a terminal or starting
    // page visited in isolation is still a valid smoke ("did the login
    // page load?"), and without this the crawl of a single labelled
    // page would produce zero journeys.
    const labels = [start.label];
    const categories: PageCategory[] = [start.category];
    const score = scoreJourney(labels, categories);
    if (score >= minScore) {
      candidates.push({
        nodes: [start.url],
        labels,
        score,
        name: journeyName(labels),
      });
    }
  }

  // De-duplicate: multiple paths with the same (start, end, labelSet)
  // signature tend to be near-identical reroutes. Keep the highest-
  // scoring one — usually the shortest, by virtue of the length penalty.
  const bySig = new Map<string, Journey>();
  for (const j of candidates) {
    const sig = signature(j);
    const prev = bySig.get(sig);
    if (!prev || j.score > prev.score) bySig.set(sig, j);
  }

  return Array.from(bySig.values())
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Stable tie-break: shorter first, then alphabetical on name.
      if (a.nodes.length !== b.nodes.length) return a.nodes.length - b.nodes.length;
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}

interface DfsFrame {
  start: string;
  current: string;
  path: string[];
  visited: Set<string>;
  adj: Map<string, { toUrl: string }[]>;
  maxLen: number;
  onPath: (path: string[]) => void;
}

function dfs(frame: DfsFrame): void {
  const outgoing = frame.adj.get(frame.current) ?? [];
  for (const edge of outgoing) {
    if (frame.visited.has(edge.toUrl)) continue;
    frame.path.push(edge.toUrl);
    frame.visited.add(edge.toUrl);
    // Record every prefix of length ≥ 2 (≥ 1 edge) as a candidate journey.
    if (frame.path.length >= 2) frame.onPath(frame.path);
    if (frame.path.length < frame.maxLen) {
      // Advance the frame cursor to the node we just entered, recurse,
      // then restore before backtracking. Mutating in place avoids
      // allocating a new frame per edge — these DFS calls run deep.
      const prevCurrent = frame.current;
      frame.current = edge.toUrl;
      dfs(frame);
      frame.current = prevCurrent;
    }
    frame.visited.delete(edge.toUrl);
    frame.path.pop();
  }
}

/**
 * Signature used for journey de-duplication. Two journeys with the same
 * start+end label and same *set* of intermediate labels are considered
 * the same flow — we don't want to emit both `login → cart → checkout`
 * and `login → checkout → cart` as distinct tests just because the
 * crawler happened to see them in both orders.
 */
function signature(j: Journey): string {
  const first = j.labels[0] ?? "";
  const last = j.labels[j.labels.length - 1] ?? "";
  const mid = j.labels.slice(1, -1).sort().join("|");
  return `${first}→${mid}→${last}`;
}

/**
 * Build a camelCase journey method name from the label sequence. The
 * convention mirrors how a human would name the test: `<start>To<end>Journey`.
 * Single-node journeys collapse to `<label>Smoke`.
 */
export function journeyName(labels: string[]): string {
  if (labels.length === 0) return "unknownJourney";
  if (labels.length === 1) {
    const only = labels[0];
    return `${camelise(only ?? "page")}Smoke`;
  }
  const first = labels[0];
  const last = labels[labels.length - 1];
  if (first === last) {
    // Rare case — a loop back to the same label. Fall back to the first
    // label only so we don't emit "loginToLoginJourney".
    return `${camelise(first ?? "page")}LoopJourney`;
  }
  return `${camelise(first ?? "start")}To${pascal(last ?? "end")}Journey`;
}

/** kebab/snake → camelCase. */
function camelise(s: string): string {
  const parts = s.split(/[^A-Za-z0-9]+/).filter((w) => w.length > 0);
  if (parts.length === 0) return "page";
  const [head, ...rest] = parts;
  const headSafe = (head ?? "page").toLowerCase();
  return headSafe + rest.map((w) => pascal(w)).join("");
}

/** First-letter-up, rest-lower (single word). */
function pascal(s: string): string {
  if (s.length === 0) return "";
  return s
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}
