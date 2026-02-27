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
import { z } from "zod";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
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

  // ──────────────────────────────────────────────
  // TOOL 1: search_tools
  // ──────────────────────────────────────────────
  server.tool(
    "search_tools",
    `Search across ${catalog.totalTools} tools from ${catalog.totalServers} MCP servers. Returns matching tool names + descriptions. Use this FIRST to find the right tool before calling it.`,
    {
      query: z
        .string()
        .describe(
          "Search query: tool name, capability, or keyword (e.g. 'file read', 'git', 'execute command')"
        ),
      max_results: z
        .number()
        .min(1)
        .max(50)
        .default(10)
        .describe("Max results to return (default 10)"),
    },
    async ({ query, max_results }) => {
      const results = catalog.search(query, max_results);

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No tools found matching "${query}". Try broader terms or use list_servers to see all available servers.`,
            },
          ],
        };
      }

      const formatted = results
        .map(
          (r, i) =>
            `${i + 1}. **${r.server}:${r.tool}** — ${r.description}`
        )
        .join("\n");

      void writeMetrics(pool, catalog);

      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${results.length} tools:\n\n${formatted}\n\nUse get_tool_schema(server, tool) to see full input schema, then call_tool(server, tool, args) to execute.`,
          },
        ],
      };
    }
  );

  // ──────────────────────────────────────────────
  // TOOL 2: get_tool_schema
  // ──────────────────────────────────────────────
  server.tool(
    "get_tool_schema",
    "Get the full JSON input schema for a specific tool. Use after search_tools to see required parameters before calling.",
    {
      server: z.string().describe("Server name (from search_tools results)"),
      tool: z.string().describe("Tool name (from search_tools results)"),
    },
    async ({ server: serverName, tool: toolName }) => {
      const schema = catalog.getToolSchema(serverName, toolName);

      if (!schema) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Tool "${toolName}" not found on server "${serverName}". Use search_tools to find the correct name.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(schema, null, 2),
          },
        ],
      };
    }
  );

  // ──────────────────────────────────────────────
  // TOOL 3: call_tool
  // ──────────────────────────────────────────────
  server.tool(
    "call_tool",
    "Execute a tool on a backend MCP server. The proxy handles connection management automatically. Servers stay alive for 5 min after last use.",
    {
      server: z.string().describe("Server name (from search_tools results)"),
      tool: z.string().describe("Tool name to execute"),
      arguments: z
        .record(z.unknown())
        .default({})
        .describe("Tool arguments as JSON object (use get_tool_schema to see required params)"),
    },
    async ({ server: serverName, tool: toolName, arguments: args }) => {
      // Validate server exists in catalog before attempting spawn
      if (!catalog.getServer(serverName)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Unknown server: '${serverName}'. Use list_servers to see available servers.`,
            },
          ],
          isError: true,
        };
      }
      // Validate tool exists on the server
      if (!catalog.getToolSchema(serverName, toolName)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Unknown tool '${toolName}' on server '${serverName}'. Use search_tools to find tools.`,
            },
          ],
          isError: true,
        };
      }

      try {
        const result = await pool.callTool(serverName, toolName, args as Record<string, unknown>);
        void writeMetrics(pool, catalog);

        // Validate response shape — backend might return unexpected format
        if (result && typeof result === "object" && "content" in (result as object)) {
          return result as { content: Array<{ type: "text"; text: string }> };
        }
        // Wrap raw response in text content block
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error calling ${serverName}:${toolName}: ${(err as Error).message}`,
            },
          ],
        };
      }
    }
  );

  // ──────────────────────────────────────────────
  // TOOL 4: list_servers
  // ──────────────────────────────────────────────
  server.tool(
    "list_servers",
    "List all available MCP servers with tool counts and connection status. Use for an overview of what's available.",
    {},
    async () => {
      const toolCounts = catalog.serverToolCounts();
      const poolStats = pool.stats();

      const lines = catalog.serverNames.map((name) => {
        const count = toolCounts[name] || 0;
        const connected = poolStats.servers.includes(name);
        const metrics = poolStats.metrics.find((m) => m.server === name);
        const status = connected
          ? `🟢 active (${metrics?.calls || 0} calls)`
          : "⚪ idle";
        return `• **${name}** — ${count} tools — ${status}`;
      });

      void writeMetrics(pool, catalog);

      return {
        content: [
          {
            type: "text" as const,
            text: `${catalog.totalServers} servers, ${catalog.totalTools} tools total:\n\n${lines.join("\n")}`,
          },
        ],
      };
    }
  );

  // Start the proxy
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

main().catch((err) => {
  process.stderr.write(`[mcp-tool-search] Fatal: ${err}\n`);
  process.exit(1);
});
