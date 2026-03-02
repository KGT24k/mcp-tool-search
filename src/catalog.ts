/**
 * MCP Tool Search — Catalog Manager
 *
 * Loads the tool catalog (catalog.json) and provides fuzzy search.
 * The catalog is pre-built by build-catalog.ts which connects to
 * each backend MCP server and snapshots its tool definitions.
 */

import { readFile } from "node:fs/promises";
import type { CatalogData, CatalogServer, SearchResult } from "./types.js";
import { LRUCache } from "./cache.js";
import type { CacheStats } from "./cache.js";

/** Pre-compiled regex for tokenization — avoids re-creation on every search call */
const TOKENIZE_RE = /[^a-z0-9\s]/g;

/**
 * Compute Levenshtein (edit) distance between two strings.
 * Used as lowest-priority fuzzy fallback for typo tolerance.
 * Inline to avoid external dependencies.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  // Early exits
  if (m === 0) return n;
  if (n === 0) return m;
  if (a === b) return 0;

  // Single-row DP (O(min(m,n)) space)
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

export class Catalog {
  private data: CatalogData | null = null;
  private searchIndex: Array<{
    tool: string;
    server: string;
    description: string;
    tokens: string[];
  }> = [];

  /** LRU cache for search results (key = "query:maxResults") */
  private searchCache = new LRUCache<SearchResult[]>({
    maxEntries: 128,
    ttlMs: 60_000, // 1 minute — catalog is static, searches are repeatable
  });

  /** LRU cache for tool schemas (key = "server:tool") */
  private schemaCache = new LRUCache<Record<string, unknown> | null>({
    maxEntries: 256,
    ttlMs: 0, // No expiry — schemas don't change until catalog reload
  });

  constructor(private readonly path: string) {}

  /** Load catalog from disk */
  async load(): Promise<void> {
    const raw = await readFile(this.path, "utf-8");
    const parsed = JSON.parse(raw);
    this.validateCatalog(parsed);
    this.data = parsed;
    this.buildIndex();
    this.clearCaches(); // Invalidate stale cache entries on reload
  }

  /** Load catalog from data directly (for testing without filesystem) */
  loadFromData(data: CatalogData): void {
    this.validateCatalog(data);
    this.data = data;
    this.buildIndex();
    this.clearCaches(); // Invalidate stale cache entries on reload
  }

  /** Validate catalog shape to prevent cryptic runtime crashes */
  private validateCatalog(data: unknown): asserts data is CatalogData {
    if (!data || typeof data !== "object") {
      throw new Error("Invalid catalog: not a JSON object");
    }
    const obj = data as Record<string, unknown>;
    if (!obj.servers || typeof obj.servers !== "object") {
      throw new Error("Invalid catalog: missing 'servers' object");
    }
    for (const [name, server] of Object.entries(
      obj.servers as Record<string, unknown>
    )) {
      if (!server || typeof server !== "object") {
        throw new Error(
          `Invalid catalog: server '${name}' is not an object`
        );
      }
      if (!Array.isArray((server as Record<string, unknown>).tools)) {
        throw new Error(
          `Invalid catalog: server '${name}' has no tools array`
        );
      }
    }
  }

  /** Build search index from catalog data */
  private buildIndex(): void {
    if (!this.data) return;
    this.searchIndex = [];

    for (const [serverName, server] of Object.entries(this.data.servers)) {
      for (const tool of server.tools) {
        const tokens = this.tokenize(
          `${tool.name} ${tool.description} ${serverName}`
        );
        this.searchIndex.push({
          tool: tool.name,
          server: serverName,
          description: tool.description,
          tokens,
        });
      }
    }
  }

  /** Tokenize a string for fuzzy matching — splits on spaces, underscores, and hyphens */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(TOKENIZE_RE, " ")
      .split(/[\s_\-]+/)
      .filter((t) => t.length > 1);
  }

  /** Fuzzy search across all tools (with LRU caching) */
  search(query: string, maxResults: number = 10): SearchResult[] {
    // Check cache first
    const cacheKey = `${query}:${maxResults}`;
    const cached = this.searchCache.get(cacheKey);
    if (cached) return cached;

    let results: SearchResult[];

    if (!query.trim()) {
      // Empty query: return all tools (compact)
      results = this.searchIndex.slice(0, maxResults).map((entry) => ({
        tool: entry.tool,
        server: entry.server,
        description: entry.description,
        score: 1,
      }));
    } else {
      const queryTokens = this.tokenize(query);
      const scored: SearchResult[] = [];

      for (const entry of this.searchIndex) {
        let score = 0;

        for (const qt of queryTokens) {
          // Exact token match
          if (entry.tokens.includes(qt)) {
            score += 3;
            continue;
          }
          // Prefix match
          if (entry.tokens.some((t) => t.startsWith(qt))) {
            score += 2;
            continue;
          }
          // Substring match
          if (entry.tokens.some((t) => t.includes(qt))) {
            score += 1;
            continue;
          }
          // Tool name contains query
          if (entry.tool.toLowerCase().includes(qt)) {
            score += 2;
            continue;
          }
          // Levenshtein fuzzy fallback — typo tolerance (e.g. "git_comit" → "git_commit")
          // Only apply when both tokens are ≥ 4 chars to prevent short-word false positives
          // (e.g. "get" ↔ "set" = distance 1, "run" ↔ "fun" = distance 1)
          if (qt.length >= 4) {
            const fuzzyMatch = entry.tokens.some(
              (t) => t.length >= 4 && levenshtein(qt, t) <= 2
            );
            if (fuzzyMatch) {
              score += 0.5;
            }
          }
        }

        if (score > 0) {
          scored.push({
            tool: entry.tool,
            server: entry.server,
            description: entry.description,
            score,
          });
        }
      }

      results = scored
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);
    }

    // Cache the result
    this.searchCache.set(cacheKey, results);
    return results;
  }

  /** Get a specific server's config */
  getServer(name: string): CatalogServer | undefined {
    return this.data?.servers[name];
  }

  /** Get a specific tool's full schema (with LRU caching) */
  getToolSchema(
    serverName: string,
    toolName: string
  ): Record<string, unknown> | undefined {
    const cacheKey = `${serverName}:${toolName}`;

    // Check cache (null means "confirmed not found")
    if (this.schemaCache.has(cacheKey)) {
      const cached = this.schemaCache.get(cacheKey);
      return cached ?? undefined;
    }

    const server = this.data?.servers[serverName];
    if (!server) {
      this.schemaCache.set(cacheKey, null);
      return undefined;
    }
    const tool = server.tools.find((t) => t.name === toolName);
    const schema = tool?.inputSchema;

    this.schemaCache.set(cacheKey, schema ?? null);
    return schema;
  }

  /** Total number of servers in catalog */
  get totalServers(): number {
    return this.data ? Object.keys(this.data.servers).length : 0;
  }

  /** Total number of tools across all servers */
  get totalTools(): number {
    return this.searchIndex.length;
  }

  /** List all server names */
  get serverNames(): string[] {
    return this.data ? Object.keys(this.data.servers) : [];
  }

  /** Get tool count per server */
  serverToolCounts(): Record<string, number> {
    if (!this.data) return {};
    const counts: Record<string, number> = {};
    for (const [name, server] of Object.entries(this.data.servers)) {
      counts[name] = server.tools.length;
    }
    return counts;
  }

  /** Get cache statistics for monitoring */
  cacheStats(): { search: CacheStats; schema: CacheStats } {
    return {
      search: this.searchCache.stats(),
      schema: this.schemaCache.stats(),
    };
  }

  /** Clear all caches (e.g. on catalog reload) */
  clearCaches(): void {
    this.searchCache.clear();
    this.schemaCache.clear();
  }
}
