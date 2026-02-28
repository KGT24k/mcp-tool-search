#!/usr/bin/env node
/**
 * MCP Tool Search — Universal MCP Proxy Server
 *
 * Reduces Claude's context token overhead by ~85-96% by replacing
 * all your MCP server tool schemas with just 4 lightweight proxy tools.
 *
 * Works with: Claude Code, Claude Desktop, Cursor, Windsurf, any MCP client.
 *
 * Instead of loading 20+ MCP tool schemas into context (thousands of tokens),
 * this proxy exposes only 4 tools:
 *
 *   1. search_tools(query) — Fuzzy search across ALL backend tools
 *   2. get_tool_schema(server, tool) — Get full input schema before calling
 *   3. call_tool(server, tool, arguments) — Proxy execution to backend
 *   4. list_servers() — Overview of servers, tools, and usage metrics
 *
 * Token savings: ~85-96% reduction in tool-definition context overhead.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { Catalog } from "./catalog.js";
import { ServerPool } from "./pool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Catalog path: env override > next to compiled JS > working directory
const catalogPath =
  process.env.MCP_TOOL_SEARCH_CATALOG ||
  resolve(__dirname, "..", "catalog.json");

// Optional: metrics log for AEGIS dashboard integration
const metricsPath = process.env.MCP_TOOL_SEARCH_METRICS || "";

/** Write metrics to disk for AEGIS dashboard consumption */
async function writeMetrics(
  pool: ServerPool,
  catalog: Catalog
): Promise<void> {
  if (!metricsPath) return;
  try {
    const dir = dirname(metricsPath);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });

    const stats = pool.stats();
    const data = {
      timestamp: new Date().toISOString(),
      totalServers: catalog.totalServers,
      totalTools: catalog.totalTools,
      activeConnections: stats.active,
      connectedServers: stats.servers,
      serverMetrics: stats.metrics,
    };

    await writeFile(metricsPath, JSON.stringify(data, null, 2), "utf-8");
  } catch {
    // Non-critical — don't crash the proxy over metrics
  }
}

async function main(): Promise<void> {
  // Load catalog
  const catalog = new Catalog(catalogPath);
  try {
    await catalog.load();
  } catch (err) {
    process.stderr.write(
      `[mcp-tool-search] ${(err as Error).message}\n` +
        `[mcp-tool-search] Run 'npm run catalog' or 'mcp-build-catalog' to create it.\n`
    );
    process.exit(1);
  }

  process.stderr.write(
    `[mcp-tool-search] Loaded: ${catalog.totalServers} servers, ${catalog.totalTools} tools\n`
  );

  if (catalog.totalTools === 0) {
    process.stderr.write(
      `[mcp-tool-search] ⚠ Warning: Catalog has 0 tools. Run 'npm run catalog' to rebuild.\n`
    );
  }

  // Create connection pool
  const pool = new ServerPool(catalog);

  // Create proxy MCP server
  const server = new McpServer({
    name: "mcp-tool-search",
    version: "2.0.0",
  });

  // Register all proxy tools on the primary server (used by stdio mode)
  registerTools(server, catalog, pool);

  // Catch unhandled rejections (e.g. from async timer callbacks)
  process.on("unhandledRejection", (err) => {
    process.stderr.write(
      `[mcp-tool-search] Unhandled rejection: ${err}\n`
    );
  });

  // Transport mode: HTTP if MCP_HTTP_PORT is set or --http flag, otherwise stdio
  const httpPort = parseInt(process.env.MCP_HTTP_PORT || "", 10);
  const useHttp = !isNaN(httpPort) || process.argv.includes("--http");
  const port = !isNaN(httpPort) ? httpPort : 3100;

  if (useHttp) {
    // Streamable HTTP transport — for remote clients, Smithery, Docker, etc.
    const sessions = new Map<string, StreamableHTTPServerTransport>();

    const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

      // Health check endpoint
      if (url.pathname === "/health" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status: "ok",
          transport: "streamable-http",
          servers: catalog.totalServers,
          tools: catalog.totalTools,
          sessions: sessions.size,
        }));
        return;
      }

      // MCP endpoint
      if (url.pathname === "/mcp") {
        // DNS rebinding protection — only allow localhost
        const host = req.headers.host || "";
        if (!host.startsWith("localhost") && !host.startsWith("127.0.0.1") && !host.startsWith("[::1]")) {
          res.writeHead(403, { "Content-Type": "text/plain" });
          res.end("Forbidden: only localhost connections allowed");
          return;
        }

        if (req.method === "POST") {
          // Check for existing session
          const sessionId = req.headers["mcp-session-id"] as string | undefined;
          let transport: StreamableHTTPServerTransport;

          if (sessionId && sessions.has(sessionId)) {
            transport = sessions.get(sessionId)!;
          } else if (!sessionId) {
            // New session — create transport and connect server
            transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => randomUUID(),
            });

            // Store session on initialization
            transport.onclose = () => {
              const sid = transport.sessionId;
              if (sid) sessions.delete(sid);
            };

            // Create a fresh MCP server for this session
            const sessionServer = new McpServer({
              name: "mcp-tool-search",
              version: "2.0.0",
            });

            // Re-register tools for this session server
            registerTools(sessionServer, catalog, pool);
            await sessionServer.connect(transport);

            if (transport.sessionId) {
              sessions.set(transport.sessionId, transport);
            }
          } else {
            // Session ID provided but not found
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Session not found");
            return;
          }

          await transport.handleRequest(req, res);
          return;
        }

        if (req.method === "GET") {
          // SSE connection for server-to-client notifications
          const sessionId = req.headers["mcp-session-id"] as string | undefined;
          if (sessionId && sessions.has(sessionId)) {
            const transport = sessions.get(sessionId)!;
            await transport.handleRequest(req, res);
            return;
          }
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Missing or invalid session ID for SSE");
          return;
        }

        if (req.method === "DELETE") {
          // Session termination
          const sessionId = req.headers["mcp-session-id"] as string | undefined;
          if (sessionId && sessions.has(sessionId)) {
            const transport = sessions.get(sessionId)!;
            await transport.handleRequest(req, res);
            sessions.delete(sessionId);
            return;
          }
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Session not found");
          return;
        }

        res.writeHead(405, { "Content-Type": "text/plain" });
        res.end("Method not allowed");
        return;
      }

      // Not found
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found — MCP endpoint is at /mcp");
    });

    httpServer.listen(port, "127.0.0.1", () => {
      process.stderr.write(
        `[mcp-tool-search] Proxy ready (streamable-http) at http://127.0.0.1:${port}/mcp\n`
      );
    });

    // Cleanup on exit
    const cleanup = async () => {
      for (const transport of sessions.values()) {
        try { await transport.close(); } catch { /* ignore */ }
      }
      sessions.clear();
      httpServer.close();
      await pool.disconnectAll();
      process.exit(0);
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

  } else {
    // Stdio transport — default for Claude Code, Claude Desktop, etc.
    const transport = new StdioServerTransport();
    await server.connect(transport);

    process.stderr.write(`[mcp-tool-search] Proxy ready (stdio)\n`);

    // Cleanup on exit
    process.on("SIGINT", async () => {
      await pool.disconnectAll();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      await pool.disconnectAll();
      process.exit(0);
    });
  }
}

/** Register all 4 proxy tools on an MCP server instance. */
function registerTools(server: McpServer, catalog: Catalog, pool: ServerPool): void {
  server.tool(
    "search_tools",
    `Search across ${catalog.totalTools} tools from ${catalog.totalServers} MCP servers. Returns matching tool names + descriptions. Use this FIRST to find the right tool before calling it.`,
    {
      query: z.string().describe("Search query: tool name, capability, or keyword"),
      max_results: z.number().min(1).max(50).default(10).describe("Max results (default 10)"),
    },
    async ({ query, max_results }) => {
      const results = catalog.search(query, max_results);
      if (results.length === 0) {
        return { content: [{ type: "text" as const, text: `No tools found matching "${query}".` }] };
      }
      const formatted = results.map((r, i) => `${i + 1}. **${r.server}:${r.tool}** — ${r.description}`).join("\n");
      void writeMetrics(pool, catalog);
      return { content: [{ type: "text" as const, text: `Found ${results.length} tools:\n\n${formatted}\n\nUse get_tool_schema then call_tool.` }] };
    }
  );

  server.tool(
    "get_tool_schema",
    "Get the full JSON input schema for a specific tool.",
    {
      server: z.string().describe("Server name"),
      tool: z.string().describe("Tool name"),
    },
    async ({ server: sn, tool: tn }) => {
      const schema = catalog.getToolSchema(sn, tn);
      if (!schema) return { content: [{ type: "text" as const, text: `Tool "${tn}" not found on "${sn}".` }] };
      return { content: [{ type: "text" as const, text: JSON.stringify(schema, null, 2) }] };
    }
  );

  server.tool(
    "call_tool",
    "Execute a tool on a backend MCP server.",
    {
      server: z.string().describe("Server name"),
      tool: z.string().describe("Tool name"),
      arguments: z.record(z.unknown()).default({}).describe("Tool arguments as JSON object"),
    },
    async ({ server: sn, tool: tn, arguments: args }) => {
      if (!catalog.getServer(sn)) return { content: [{ type: "text" as const, text: `Unknown server: '${sn}'.` }], isError: true };
      if (!catalog.getToolSchema(sn, tn)) return { content: [{ type: "text" as const, text: `Unknown tool '${tn}' on '${sn}'.` }], isError: true };
      try {
        const result = await pool.callTool(sn, tn, args as Record<string, unknown>);
        void writeMetrics(pool, catalog);
        if (result && typeof result === "object" && "content" in (result as object)) return result as { content: Array<{ type: "text"; text: string }> };
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    "list_servers",
    "List all available MCP servers with tool counts and connection status.",
    {},
    async () => {
      const tc = catalog.serverToolCounts();
      const ps = pool.stats();
      const lines = catalog.serverNames.map((name) => {
        const count = tc[name] || 0;
        const connected = ps.servers.includes(name);
        const metrics = ps.metrics.find((m) => m.server === name);
        const status = connected ? `active (${metrics?.calls || 0} calls)` : "idle";
        return `- **${name}** — ${count} tools — ${status}`;
      });
      void writeMetrics(pool, catalog);
      return { content: [{ type: "text" as const, text: `${catalog.totalServers} servers, ${catalog.totalTools} tools:\n\n${lines.join("\n")}` }] };
    }
  );
}

main().catch((err) => {
  process.stderr.write(`[mcp-tool-search] Fatal: ${err}\n`);
  process.exit(1);
});
