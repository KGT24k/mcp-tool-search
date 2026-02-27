#!/usr/bin/env node
/**
 * MCP Tool Search — Catalog Builder
 *
 * Connects to each MCP server defined in Claude Code's settings,
 * discovers all available tools, and saves them to catalog.json.
 *
 * Usage: npm run catalog
 *
 * The catalog is a snapshot — rebuild it when you add/remove MCP servers.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type { CatalogData, CatalogServer, CatalogTool } from "./types.js";
import { resolveCommand, buildSafeEnv } from "./utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "..", "catalog.json");

// Timeout for connecting to each server (ms)
const CONNECT_TIMEOUT = 15_000;

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/** Find and load MCP server configs from Claude settings */
async function loadMcpConfigs(): Promise<Record<string, McpServerConfig>> {
  // Check multiple possible config locations
  const candidates = [
    // Claude Code project-level
    resolve(process.cwd(), ".mcp.json"),
    // Claude Code user-level
    resolve(homedir(), ".claude", "settings.json"),
    // Claude Desktop
    resolve(
      homedir(),
      "AppData",
      "Roaming",
      "Claude",
      "claude_desktop_config.json"
    ),
    // macOS Claude Desktop
    resolve(
      homedir(),
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json"
    ),
  ];

  const allConfigs: Record<string, McpServerConfig> = {};

  for (const path of candidates) {
    if (!existsSync(path)) continue;

    try {
      const raw = JSON.parse(await readFile(path, "utf-8"));

      // .mcp.json format: { "mcpServers": { ... } }
      // settings.json format: { "mcpServers": { ... } }
      // claude_desktop_config.json format: { "mcpServers": { ... } }
      const servers: Record<string, McpServerConfig> =
        raw.mcpServers || raw.MCP_SERVERS || {};

      for (const [name, config] of Object.entries(servers)) {
        // Fix 1: Skip disabled servers
        if ((config as McpServerConfig & { disabled?: boolean }).disabled === true) {
          process.stderr.write(`  Skipped: ${name} (disabled)\n`);
          continue;
        }
        if (!allConfigs[name]) {
          allConfigs[name] = config;
          process.stderr.write(`  Found: ${name} (from ${path})\n`);
        }
      }
    } catch (err) {
      process.stderr.write(`  Warning: Could not parse ${path}: ${err}\n`);
    }
  }

  return allConfigs;
}

/** Connect to a server and discover its tools */
async function discoverTools(
  name: string,
  config: McpServerConfig
): Promise<CatalogServer | null> {
  const transport = new StdioClientTransport({
    command: resolveCommand(config.command),
    args: config.args || [],
    env: buildSafeEnv(config.env),
  });

  const client = new Client(
    { name: "mcp-catalog-builder", version: "2.0.0" },
    { capabilities: {} }
  );

  try {
    // Connect with timeout
    let timer: ReturnType<typeof setTimeout>;
    await Promise.race([
      client.connect(transport),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Connection timeout")), CONNECT_TIMEOUT);
      }),
    ]).finally(() => clearTimeout(timer!));

    // List all tools
    const response = await client.listTools();
    const tools: CatalogTool[] = (response.tools || []).map((t) => ({
      name: t.name,
      description: t.description || "",
      inputSchema: (t.inputSchema as Record<string, unknown>) || {},
    }));

    await client.close();

    // Store env keys but redact values that look like secrets/tokens
    const scrubbed: Record<string, string> = {};
    if (config.env) {
      for (const [k, v] of Object.entries(config.env)) {
        const lk = k.toLowerCase();
        if (lk.includes("token") || lk.includes("secret") || lk.includes("key") || lk.includes("password") || lk.includes("auth")) {
          scrubbed[k] = "***REDACTED***";
        } else {
          scrubbed[k] = v;
        }
      }
    }

    return {
      command: config.command,
      args: config.args || [],
      env: Object.keys(scrubbed).length > 0 ? scrubbed : undefined,
      tools,
    };
  } catch (err) {
    process.stderr.write(
      `  ✗ ${name}: ${(err as Error).message}\n`
    );
    try {
      await client.close();
    } catch {
      // Ignore
    }
    return null;
  }
}

async function main(): Promise<void> {
  process.stderr.write("╔══════════════════════════════════════╗\n");
  process.stderr.write("║  MCP Tool Search — Catalog Builder   ║\n");
  process.stderr.write("╚══════════════════════════════════════╝\n\n");

  // Step 1: Find MCP server configs
  process.stderr.write("[1/3] Scanning for MCP server configurations...\n");
  const configs = await loadMcpConfigs();

  const serverNames = Object.keys(configs);
  if (serverNames.length === 0) {
    process.stderr.write(
      "\nNo MCP servers found. Make sure you have:\n" +
        "  - .mcp.json in your project root, OR\n" +
        "  - ~/.claude/settings.json with mcpServers, OR\n" +
        "  - Claude Desktop config with mcpServers\n"
    );
    process.exit(1);
  }

  // Fix 3: Parse --only and --skip CLI flags to filter servers
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const skipArg = process.argv.find((a) => a.startsWith("--skip="));

  if (onlyArg && skipArg) {
    process.stderr.write(
      "\nError: Cannot use --only and --skip together. Pick one.\n"
    );
    process.exit(1);
  }

  // Self-skip: never try to spawn ourselves during catalog build
  let filteredNames = serverNames.filter((n) => n !== "mcp-tool-search");

  if (onlyArg) {
    const onlySet = new Set(onlyArg.replace("--only=", "").split(",").map((s) => s.trim()));
    filteredNames = filteredNames.filter((n) => onlySet.has(n));
    process.stderr.write(`  --only filter: ${filteredNames.length}/${serverNames.length} servers selected\n`);
  }

  if (skipArg) {
    const skipSet = new Set(skipArg.replace("--skip=", "").split(",").map((s) => s.trim()));
    filteredNames = filteredNames.filter((n) => !skipSet.has(n));
    process.stderr.write(`  --skip filter: ${filteredNames.length}/${serverNames.length} servers selected\n`);
  }

  process.stderr.write(`\nFound ${filteredNames.length} servers.\n\n`);

  // Step 2: Connect and discover tools
  process.stderr.write("[2/3] Discovering tools from each server...\n");
  const catalog: CatalogData = {
    version: "2.0.0",
    generated: new Date().toISOString(),
    servers: {},
  };

  let totalTools = 0;
  let failedServers = 0;

  // Parallel discovery — all servers spawn simultaneously
  const discoveryResults = await Promise.allSettled(
    filteredNames.map(async (name) => {
      process.stderr.write(`  → ${name}...\n`);
      const server = await discoverTools(name, configs[name]);
      return { name, server };
    })
  );

  for (const result of discoveryResults) {
    if (result.status === "fulfilled" && result.value.server) {
      catalog.servers[result.value.name] = result.value.server;
      totalTools += result.value.server.tools.length;
      process.stderr.write(`  ✓ ${result.value.name}: ${result.value.server.tools.length} tools\n`);
    } else if (result.status === "rejected") {
      failedServers++;
      process.stderr.write(`  ✗ ${(result as PromiseRejectedResult).reason}\n`);
    } else if (result.status === "fulfilled" && !result.value.server) {
      failedServers++;
    }
  }

  // Step 3: Save catalog
  process.stderr.write(`\n[3/3] Saving catalog to ${OUTPUT_PATH}...\n`);
  await writeFile(OUTPUT_PATH, JSON.stringify(catalog, null, 2), "utf-8");

  process.stderr.write("\n══════════════════════════════════════\n");
  process.stderr.write(
    `  Catalog built: ${Object.keys(catalog.servers).length} servers, ${totalTools} tools\n`
  );
  if (failedServers > 0) {
    process.stderr.write(
      `  ⚠ ${failedServers} server(s) failed to connect\n`
    );
  }
  process.stderr.write("══════════════════════════════════════\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
