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
const CALL_TIMEOUT_MS = 30_000;        // 30 seconds per tool call
const MAX_RETRIES = 3;                 // max retry attempts for transient failures
const RETRY_BASE_MS = 500;             // exponential backoff base delay
const RETRY_MAX_MS = 8_000;            // max backoff delay cap

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

    let timer: ReturnType<typeof setTimeout>;
    await Promise.race([
      client.connect(transport),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Connection to ${serverName} timed out after ${CONNECT_TIMEOUT_MS}ms`)),
          CONNECT_TIMEOUT_MS
        );
      }),
    ]).finally(() => clearTimeout(timer!));

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

  /**
   * Call a tool on a backend server with timeout + exponential backoff retry.
   *
   * Retry strategy:
   * - Connection errors (EPIPE, ECONNRESET, etc.): reconnect and retry up to MAX_RETRIES
   * - Timeout errors: retry with fresh connection up to MAX_RETRIES
   * - Application errors (tool returned an error): NOT retried (may not be idempotent)
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const client = await this.getClient(serverName);
      const entry = this.connections.get(serverName)!;
      entry.calls++;

      try {
        // Apply per-call timeout
        const result = await this.withTimeout(
          client.callTool({ name: toolName, arguments: args }),
          CALL_TIMEOUT_MS,
          `${serverName}:${toolName}`
        );
        return result;
      } catch (err) {
        entry.errors++;
        lastError = err instanceof Error ? err : new Error(String(err));

        const isRetryable = this.isRetryableError(lastError);

        if (!isRetryable || attempt >= MAX_RETRIES) {
          // Non-retryable error or exhausted retries
          if (attempt > 0) {
            process.stderr.write(
              `[mcp-tool-search] ${serverName}:${toolName} failed after ${attempt + 1} attempts: ${lastError.message}\n`
            );
          }
          throw lastError;
        }

        // Exponential backoff with jitter
        const delay = this.backoffDelay(attempt);
        process.stderr.write(
          `[mcp-tool-search] ${serverName}:${toolName} attempt ${attempt + 1} failed (${lastError.message}), retrying in ${delay}ms...\n`
        );

        // Reconnect if connection error
        if (this.connections.has(serverName)) {
          await this.disconnect(serverName);
        }

        await this.sleep(delay);
      }
    }

    throw lastError ?? new Error(`${serverName}:${toolName} failed after retries`);
  }

  /** Wrap a promise with a timeout */
  private withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    label: string
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timeout: ${label} exceeded ${timeoutMs}ms`)),
        timeoutMs
      );
      timer.unref(); // Don't block Node exit

      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  /** Determine if an error is retryable (connection/transport errors) */
  private isRetryableError(err: Error): boolean {
    const msg = err.message;
    return (
      msg.includes("EPIPE") ||
      msg.includes("ERR_IPC_CHANNEL_CLOSED") ||
      msg.includes("spawn") ||
      msg.includes("ECONNRESET") ||
      msg.includes("ENOENT") ||
      msg.includes("not connected") ||
      msg.includes("Connection closed") ||
      msg.includes("Timeout:")
    );
  }

  /** Calculate exponential backoff delay with jitter */
  private backoffDelay(attempt: number): number {
    const base = RETRY_BASE_MS * Math.pow(2, attempt);
    const jitter = Math.random() * RETRY_BASE_MS;
    return Math.min(base + jitter, RETRY_MAX_MS);
  }

  /** Async sleep utility */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Reset idle timeout for a server */
  private resetTimer(serverName: string): void {
    const entry = this.connections.get(serverName);
    if (!entry) return;

    if (entry.timer) clearTimeout(entry.timer);

    entry.timer = setTimeout(async () => {
      try { await this.disconnect(serverName); } catch { /* ignore */ }
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
