/**
 * MCP Tool Search - Type Definitions
 * Shared types for catalog, pool, and proxy server.
 */

/** A single tool entry in the catalog */
export interface CatalogTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** A server entry in the catalog with its tools and spawn config */
export interface CatalogServer {
  command: string;
  args: string[];
  env?: Record<string, string>;
  tools: CatalogTool[];
}

/** The full catalog structure (serialized to catalog.json) */
export interface CatalogData {
  version: string;
  generated: string;
  servers: Record<string, CatalogServer>;
}

/** Search result returned to Claude */
export interface SearchResult {
  tool: string;
  server: string;
  description: string;
  score: number;
}

/** Server connection metrics */
export interface ServerMetrics {
  server: string;
  calls: number;
  errors: number;
  lastUsed: string;
  connected: boolean;
}
