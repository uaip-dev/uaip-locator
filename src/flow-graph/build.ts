/**
 * Build a FlowGraph from a CrawlResult.
 *
 * Inputs:
 *   - `pages`     — one snapshot per visited URL
 *   - `edges`     — every `<a href>` observed during crawl
 *   - `pageLabels` — primary-label assignments from @uaip/semantic
 *
 * Output:
 *   - nodes: one per visited page that has a label
 *   - edges: only the `status === "visited"` subset (navigations we can
 *     actually reproduce in a test)
 *
 * Nodes without labels are elided — a journey through "unknown → unknown
 * → unknown" is neither nameable nor useful as a smoke scenario. The
 * upstream assumption is that the rule registry is comprehensive enough
 * that real customer pages get *some* label; if that turns out not to be
 * true we'd reconsider this filter.
 */
import type {
  CrawlResult,
  FlowEdge,
  FlowGraph,
  FlowNode,
  PageLabel,
} from "../types/index.js";
import { primaryLabel } from "../semantic-rules/index.js";

export interface BuildFlowGraphOptions {
  /**
   * If true, include nodes that only matched shell-category rules
   * (top-nav, footer, etc.). Off by default — shell labels are too broad
   * to drive meaningful journey naming.
   */
  includeShell?: boolean;

  /**
   * If true, pages with no matching PageRule still become nodes, using a
   * label synthesised from the URL path (e.g. `/basic_auth` → "Basic Auth",
   * category `"content"`, confidence 0.3). This keeps the graph useful for
   * sites whose vocabulary doesn't match the built-in rule set (e.g. any
   * non-ecommerce playground). Off by default so unit tests and fixtures
   * built against the rule-only shape stay deterministic.
   */
  fallbackUrlLabels?: boolean;
}

/**
 * Build a FlowGraph from a crawl. Returns a graph even on inputs with no
 * labels (empty nodes/edges arrays) so downstream code can unconditionally
 * assign `crawl.flowGraph = buildFlowGraph(crawl)` without a null check.
 */
export function buildFlowGraph(
  crawl: CrawlResult,
  opts: BuildFlowGraphOptions = {},
): FlowGraph {
  const includeShell = opts.includeShell === true;
  const fallbackUrlLabels = opts.fallbackUrlLabels === true;
  const labels = crawl.pageLabels ?? {};
  const nodes: FlowNode[] = [];

  // Index from URL → node, so we can filter edges cheaply and avoid
  // double-adding nodes if the crawler ever produces two snapshots per URL.
  const nodeByUrl = new Map<string, FlowNode>();

  for (const page of crawl.pages) {
    const matches = labels[page.url];
    const primary = pickPrimary(matches, includeShell);
    let node: FlowNode | null = null;
    if (primary) {
      node = {
        url: page.url,
        title: page.title,
        label: primary.label,
        category: primary.category,
        confidence: primary.confidence,
      };
    } else if (fallbackUrlLabels) {
      // No rule fired — synthesise a label from the URL path so the page
      // still appears as a node. Low confidence so any real rule hit beats
      // it if the registry grows later.
      const synth = labelFromUrl(page.url, page.title);
      if (synth) {
        node = {
          url: page.url,
          title: page.title,
          label: synth.label,
          category: synth.category,
          confidence: 0.3,
        };
      }
    }
    if (!node) continue;
    if (nodeByUrl.has(page.url)) continue;
    nodes.push(node);
    nodeByUrl.set(page.url, node);
  }

  const edges: FlowEdge[] = [];
  const seenEdge = new Set<string>();
  for (const ce of crawl.edges ?? []) {
    if (ce.status !== "visited") continue;
    if (!nodeByUrl.has(ce.fromUrl) || !nodeByUrl.has(ce.toUrl)) continue;
    if (ce.fromUrl === ce.toUrl) continue; // self-loops add no signal
    const key = `${ce.fromUrl}\u0000${ce.toUrl}`;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    const edge: FlowEdge = { fromUrl: ce.fromUrl, toUrl: ce.toUrl };
    if (ce.linkText !== undefined) edge.linkText = ce.linkText;
    edges.push(edge);
  }

  return { nodes, edges };
}

/**
 * Pick the best label for a page in the flow-graph sense.
 *
 * `primaryLabel()` from @uaip/semantic already prefers non-shell matches,
 * falling back to shell when nothing else fired. We gate that fallback
 * behind `includeShell` so the default graph is built from substantive
 * page types only — a top-nav-only label would otherwise produce a node
 * that names a "top-navToTopNavJourney".
 */
function pickPrimary(
  matches: PageLabel[] | undefined,
  includeShell: boolean,
): PageLabel | null {
  const picked = primaryLabel(matches);
  if (!picked) return null;
  if (!includeShell && picked.category === "shell") return null;
  return picked;
}

/**
 * Derive a fallback node label from a URL when no PageRule fired. Uses
 * the last non-empty path segment, falling back to the hostname for the
 * site root. Always returns category `"content"` — we don't guess auth
 * or commerce from the URL alone because that's a false-confidence trap.
 *
 * Examples:
 *   https://the-internet.herokuapp.com/            → "the-internet.herokuapp.com"
 *   https://the-internet.herokuapp.com/basic_auth  → "Basic Auth"
 *   https://example.com/products/123/details       → "Details"
 *   https://example.com/checkout.html              → "Checkout"
 */
function labelFromUrl(
  rawUrl: string,
  title: string | undefined,
): { label: string; category: "content" } | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  const segments = u.pathname.split("/").filter((s) => s.length > 0);
  let segLabel: string | null = null;
  if (segments.length > 0) {
    const last = segments[segments.length - 1]!;
    // Strip trailing file extension (.html, .php) before humanising.
    const withoutExt = last.replace(/\.[a-z0-9]{1,5}$/i, "") || last;
    const humanised = withoutExt
      .replace(/[-_.]+/g, " ")
      .trim()
      .replace(/\s+/g, " ")
      .split(" ")
      .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
      .join(" ");
    if (humanised.length > 0) segLabel = humanised;
  }
  // Site root — prefer the document title if the crawler captured one,
  // otherwise fall back to the hostname. Either is better than "home".
  const label =
    segLabel ??
    (title && title.trim().length > 0 ? title.trim().slice(0, 60) : u.hostname);
  return { label, category: "content" };
}

/**
 * Build an adjacency map (URL → outgoing edges) from a FlowGraph. Kept
 * out of the graph shape itself so the graph stays JSON-serialisable
 * without losing the adjacency structure on save/load.
 */
export function adjacency(graph: FlowGraph): Map<string, FlowEdge[]> {
  const out = new Map<string, FlowEdge[]>();
  for (const node of graph.nodes) out.set(node.url, []);
  for (const edge of graph.edges) {
    const bucket = out.get(edge.fromUrl);
    if (bucket) bucket.push(edge);
  }
  return out;
}
