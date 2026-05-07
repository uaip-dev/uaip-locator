/**
 * BFS frontier — the queue of URLs to crawl plus a visited set for dedup.
 *
 * Intentionally plain: a FIFO array for pending items and a Map for the
 * visited set. Big-O is fine at Phase 0 scale (~25 pages). At Phase 2 we can
 * swap in a real priority queue if we want per-URL scoring.
 *
 * The visited set is keyed by *normalised URL*, so callers must normalise
 * before calling `enqueue`. We don't re-normalise inside to keep this module
 * pure and predictable.
 */

export interface FrontierItem {
  /** Normalised URL. */
  url: string;
  /** BFS depth from the start URL (start = 0). */
  depth: number;
  /** Optional parent URL — useful for edge-graph bookkeeping. */
  parentUrl?: string;
}

export interface FrontierFailure {
  url: string;
  reason: string;
  attemptedAt: string;
}

export class Frontier {
  private readonly pending: FrontierItem[] = [];
  private readonly visited = new Map<string, number>();
  private readonly failed: FrontierFailure[] = [];

  /**
   * Add an item to the queue. Returns true if newly added, false if the URL
   * was already in the visited set (whether or not it's been dequeued yet).
   */
  enqueue(item: FrontierItem): boolean {
    if (this.visited.has(item.url)) return false;
    this.visited.set(item.url, item.depth);
    this.pending.push(item);
    return true;
  }

  /** Pull the next pending URL (FIFO → BFS). */
  dequeue(): FrontierItem | undefined {
    return this.pending.shift();
  }

  /** Number of items still waiting to be crawled. */
  pendingCount(): number {
    return this.pending.length;
  }

  /** Total URLs ever enqueued (includes currently-pending and done). */
  visitedCount(): number {
    return this.visited.size;
  }

  /** True if the URL has been seen (enqueued at any point). */
  hasSeen(url: string): boolean {
    return this.visited.has(url);
  }

  /** Record a URL that failed to visit. Doesn't affect the visited set. */
  markFailed(url: string, reason: string): void {
    this.failed.push({ url, reason, attemptedAt: new Date().toISOString() });
  }

  /** Snapshot of failures for inclusion in the CrawlResult. */
  getFailures(): FrontierFailure[] {
    return [...this.failed];
  }
}
