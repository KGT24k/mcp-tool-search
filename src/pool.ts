/**
 * MCP Tool Search — Server Connection Pool
 *
 * Lazily spawns backend MCP servers on first tool call,
 * keeps them alive for 5 minutes after last use, then cleans up.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Catalog } from "./catalog.js";
import type { ServerMetrics } from "./types.js";
import { resolveCommand, buildSafeEnv } from "./utils.js";

interface PoolEntry {
  client: Client;
  transport: StdioClientTransport;
  lastUsed: number;
  calls: number;
  errors: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const CONNECT_TIMEOUT_MS = 15_000;     // 15 seconds
const MAX_CONCURRENT = 20;             // max simultaneous server connections

export class ServerPool {
  private connections = new Map<string, PoolEntry>();

  constructor(private readonly catalog: Catalog) {}

  /** Get or create a connection to a backend MCP server */
  async getClient(serverName: string): Promise<Client> {
    // Return existing connection
    const existing = this.connections.get(serverName);
    if (existing) {
      existing.lastUsed = Date.now();
      this.resetTimer(serverName);
      return existing.client;
    }

    // Enforce connection limit
    if (this.connections.size >= MAX_CONCURRENT) {
      // Evict oldest idle connection
      let oldest: string | null = null;
      let oldestTime = Infinity;
      for (const [name, entry] of this.connections) {
        if (entry.lastUsed < oldestTime) {
          oldestTime = entry.lastUsed;
          oldest = name;
        }
      }
      if (oldest) await this.disconnect(oldest);
    }

    // Spawn new connection
    const serverConfig = this.catalog.getServer(serverName);
    if (!serverConfig) {
      throw new Error(`Unknown server: ${serverName}`);
    }

    const transport = new StdioClientTransport({
      command: resolveCommand(serverConfig.command),
      args: serverConfig.args,
      env: buildSafeEnv(serverConfig.env),
    });

    const client = new Client(
      { name: "mcp-tool-search-proxy", version: "2.0.0" },
      { capabilities: {} }
    );

    await Promise.race([
      client.connect(transport),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Connection to ${serverName} timed out after ${CONNECT_TIMEOUT_MS}ms`)),
          CONNECT_TIMEOUT_MS
        )
      ),
    ]);

    const entry: PoolEntry = {
      client,
      transport,
      lastUsed: Date.now(),
      calls: 0,
      errors: 0,
      timer: null,
    };

    this.connections.set(serverName, entry);
    this.resetTimer(serverName);

    process.stderr.write(
      `[mcp-tool-search] Connected to ${serverName}\n`
    );

    return client;
  }

  /** Call a tool on a backend server (with auto-reconnect on failure) */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const client = await this.getClient(serverName);
    const entry = this.connections.get(serverName)!;
    entry.calls++;

    try {
      const result = await client.callTool({ name: toolName, arguments: args });
      return result;
    } catch (err) {
      entry.errors++;

      // Auto-reconnect only on transport/connection errors (backend crashed).
      // Scoped to prevent double-execution of non-idempotent tools.
      const msg = err instanceof Error ? err.message : String(err);
      const isConnectionError =
        msg.includes("EPIPE") ||
        msg.includes("ERR_IPC_CHANNEL_CLOSED") ||
        msg.includes("spawn") ||
        msg.includes("ECONNRESET") ||
        msg.includes("ENOENT") ||
        msg.includes("not connected");

      if (isConnectionError && this.connections.has(serverName)) {
        process.stderr.write(
          `[mcp-tool-search] ${serverName} connection lost, reconnecting...\n`
        );
        await this.disconnect(serverName);

        try {
          const retryClient = await this.getClient(serverName);
          const retryEntry = this.connections.get(serverName)!;
          retryEntry.calls++;
          return await retryClient.callTool({ name: toolName, arguments: args });
        } catch (retryErr) {
          process.stderr.write(
            `[mcp-tool-search] ${serverName} reconnect failed: ${(retryErr as Error).message}\n`
          );
          throw retryErr;
        }
      }

      throw err;
    }
  }

  /** Reset idle timeout for a server */
  private resetTimer(serverName: string): void {
    const entry = this.connections.get(serverName);
    if (!entry) return;

    if (entry.timer) clearTimeout(entry.timer);

    entry.timer = setTimeout(async () => {
      await this.disconnect(serverName);
    }, IDLE_TIMEOUT_MS);
    entry.timer.unref();
  }

  /** Disconnect a specific server */
  async disconnect(serverName: string): Promise<void> {
    const entry = this.connections.get(serverName);
    if (!entry) return;

    if (entry.timer) clearTimeout(entry.timer);

    try {
      await entry.client.close();
    } catch {
      // Ignore close errors
    }

    this.connections.delete(serverName);
    process.stderr.write(
      `[mcp-tool-search] Disconnected ${serverName} (idle)\n`
    );
  }

  /** Disconnect all servers (parallel) */
  async disconnectAll(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.connections.keys()).map((name) => this.disconnect(name))
    );
  }

  /** Get pool statistics */
  stats(): { active: number; servers: string[]; metrics: ServerMetrics[] } {
    const metrics: ServerMetrics[] = [];
    for (const [name, entry] of this.connections) {
      metrics.push({
        server: name,
        calls: entry.calls,
        errors: entry.errors,
        lastUsed: new Date(entry.lastUsed).toISOString(),
        connected: true,
      });
    }

    return {
      active: this.connections.size,
      servers: Array.from(this.connections.keys()),
      metrics,
    };
  }
}
