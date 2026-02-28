# MCP Tool Search

[![npm version](https://img.shields.io/npm/v/mcp-tool-search.svg)](https://www.npmjs.com/package/mcp-tool-search)
[![npm downloads](https://img.shields.io/npm/dm/mcp-tool-search.svg)](https://www.npmjs.com/package/mcp-tool-search)
[![npm audit](https://img.shields.io/badge/npm%20audit-0%20vulnerabilities-brightgreen.svg)](https://www.npmjs.com/package/mcp-tool-search)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/tests-36%2F36-brightgreen.svg)](src/__tests__)

**Reduce MCP tool-definition context overhead by ~85–96%.**

MCP Tool Search is a proxy server that replaces dozens of MCP tool schemas in your model's context window with just 4 lightweight tools. Instead of loading every tool definition upfront, the model searches for tools on-demand and calls them through the proxy.

```
Before: 50 tool schemas loaded → ~10,000 context tokens consumed every turn
After:  4 proxy tools loaded   →    ~600 context tokens (constant)
```

## Problem

Every MCP server you add dumps its full tool schemas into the model's context window. With 5+ servers and 40+ tools, that's **8,000–20,000+ tokens** of schema definitions the model must process on every single turn — even when it doesn't use any of them.

## Solution

MCP Tool Search sits between your MCP client and your backend servers:

1. **Catalog Builder** pre-scans all your MCP servers and snapshots their tool definitions to a local JSON file
2. **Proxy Server** exposes only 4 tools — the model searches, inspects, and calls tools through the proxy
3. **Lazy Connections** — backend servers are spawned on first use and kept alive for 5 minutes

```
MCP Client ←→ MCP Tool Search Proxy ←→ Backend MCP Servers
                     ↓                    (lazily spawned)
               catalog.json             Context7, GitHub, etc.
               (pre-built snapshot)
```

## The 4 Proxy Tools

| Tool | Purpose |
|------|---------|
| `search_tools` | Fuzzy-search across all backend tools by keyword or capability |
| `get_tool_schema` | Retrieve the full input schema for a specific tool |
| `call_tool` | Execute a tool on its backend server through the proxy |
| `list_servers` | List all cataloged servers and their connection status |

## Quick Start

```bash
npx mcp-tool-search --help
# Or: npm install -g mcp-tool-search && mcp-build-catalog && mcp-tool-search
```

## Installation

### Option A: npm (recommended)

```bash
npm install -g mcp-tool-search
```

### Option B: From source

```bash
git clone https://github.com/KGT24k/mcp-tool-search.git
cd mcp-tool-search
npm install
npm run build
```

## Setup

### 1. Configure backend servers

MCP Tool Search reads your MCP client's server configuration to discover backend tools. It uses the same `.mcp.json` format as Claude Code.

### 2. Build the tool catalog

```bash
# If installed globally:
mcp-build-catalog

# If from source:
npm run catalog
```

This connects to each configured MCP server, snapshots their tool definitions, and writes `catalog.json`. The proxy itself is automatically excluded from the catalog.

### 3. Add the proxy to your MCP client

Choose your client below for the correct configuration:

<details>
<summary><strong>Claude Code</strong></summary>

Add to your `.mcp.json` in the project root (or `~/.mcp.json` for global config):

```json
{
  "mcpServers": {
    "mcp-tool-search": {
      "command": "npx",
      "args": ["-y", "mcp-tool-search"]
    }
  }
}
```

Or if installed from source:

```json
{
  "mcpServers": {
    "mcp-tool-search": {
      "command": "node",
      "args": ["/path/to/mcp-tool-search/dist/index.js"]
    }
  }
}
```

</details>

<details>
<summary><strong>Claude Desktop</strong></summary>

Add to your `claude_desktop_config.json`:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mcp-tool-search": {
      "command": "npx",
      "args": ["-y", "mcp-tool-search"]
    }
  }
}
```

</details>

<details>
<summary><strong>Cursor</strong></summary>

Add to your Cursor MCP settings (`.cursor/mcp.json` in your project or global config):

```json
{
  "mcpServers": {
    "mcp-tool-search": {
      "command": "npx",
      "args": ["-y", "mcp-tool-search"]
    }
  }
}
```

</details>

<details>
<summary><strong>Windsurf</strong></summary>

Add to your Windsurf MCP configuration (`~/.codeium/windsurf/mcp_config.json`):

```json
{
  "mcpServers": {
    "mcp-tool-search": {
      "command": "npx",
      "args": ["-y", "mcp-tool-search"]
    }
  }
}
```

</details>

### 4. Disable direct backend servers

Remove or disable your other MCP server entries in `.mcp.json` — the proxy handles all tool calls to them now.

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `MCP_TOOL_SEARCH_CATALOG` | `./catalog.json` | Path to the catalog file |
| `MCP_TOOL_SEARCH_METRICS` | *(none)* | Path to write JSON metrics (for monitoring dashboards) |

## Token Savings

The proxy's token footprint is **constant** — 4 tools regardless of how many backend servers exist.

| Backend Tools | Direct Tokens | Proxy Tokens | Savings |
|---|---|---|---|
| 10 | ~2,000 | ~600 | 70% |
| 25 | ~5,000 | ~600 | 88% |
| 50 | ~10,000 | ~600 | 94% |
| 100 | ~20,000 | ~600 | 97% |
| 200 | ~40,000 | ~600 | 99% |

See [BENCHMARKS.md](BENCHMARKS.md) for detailed methodology and measurements.

## Security

MCP Tool Search uses an **allowlist-based environment filter** when spawning backend servers. Only explicitly safe environment variables (PATH, HOME, NODE_PATH, etc.) are forwarded to child processes. API keys, tokens, and secrets from your shell environment are **never** leaked to backend servers unless explicitly configured in the catalog's per-server `env` block.

Additional security measures:

- **Connection cap**: Max 20 concurrent server connections (oldest idle connection evicted when limit reached)
- **Connect timeout**: 15-second timeout on server spawn
- **Idle cleanup**: Connections auto-close after 5 minutes of inactivity
- **No shell execution**: Server commands passed as arrays to `child_process.spawn()`, never through shell interpretation
- **TypeScript strict mode**: Full type safety with no `any` casts in core logic
- **Minimal dependencies**: Only 2 runtime deps (`@modelcontextprotocol/sdk`, `zod`)

> **Note:** `catalog.json` stores per-server env vars from your MCP config (including API tokens that backend servers need to function). Treat this file as sensitive — it is excluded from git (`.gitignore`) and npm publishing (`.npmignore` + `"files"` allowlist) by default. Do not share or commit it.

## Trade-offs

- **Latency**: Each tool call requires a search + schema lookup step (~2 extra LLM turns for first use of a tool)
- **Discovery**: The model must search for tools instead of seeing them all upfront — minor overhead for small catalogs
- **Connection startup**: Servers are lazily spawned, so first calls to a new server have connection overhead

### When to use the proxy

- **Use it** when you have 5+ MCP servers or 20+ total tools
- **Skip it** when you have 1–2 servers with few tools

## Compatibility

Tested with:

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (primary target)
- [Claude Desktop](https://claude.ai/download)
- [Cursor](https://cursor.sh/)
- [Windsurf](https://codeium.com/windsurf)

Should work with any MCP client that supports the stdio transport.

## Project Structure

```
mcp-tool-search/
├── src/
│   ├── types.ts          # Shared type definitions
│   ├── catalog.ts        # Catalog loader + fuzzy search engine
│   ├── pool.ts           # Lazy server connection pool with timeouts
│   ├── index.ts          # Main proxy MCP server
│   └── build-catalog.ts  # Catalog builder CLI
├── dist/                 # Compiled JavaScript (after build)
├── catalog.json          # Generated tool catalog (git-ignored)
├── package.json
├── tsconfig.json
└── README.md
```

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests
npm test

# Watch mode
npm run dev

# Rebuild catalog
npm run catalog
```

## Contributing

Contributions are welcome! Here's how to get started:

1. **Fork** the repository and clone your fork
2. **Install dependencies:** `npm install`
3. **Build:** `npm run build`
4. **Run tests:** `npm test` (all 36 tests must pass)
5. **Make your changes** on a feature branch
6. **Submit a PR** with a clear description of what changed and why

### Guidelines

- Follow the existing TypeScript style (strict mode, no `any` in core logic)
- Add tests for new features or bug fixes
- Keep dependencies minimal -- any new runtime dependency needs strong justification
- Run `npm audit` and ensure 0 vulnerabilities before submitting
- Update documentation if your change affects the public API or setup process

### Reporting Issues

Found a bug or have a feature request? [Open an issue](https://github.com/KGT24k/mcp-tool-search/issues) on GitHub.

For security vulnerabilities, please use [GitHub Security Advisories](https://github.com/KGT24k/mcp-tool-search/security/advisories) instead of public issues.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for a detailed history of all releases.

## Security

Using many MCP servers? **Audit your configs first.**

[**Config Guard**](https://github.com/KGT24k/config-guard) scans your `.mcp.json` for 16 types of security vulnerabilities — typosquatting, known CVEs, secret leaks, rug pulls, and more. Zero dependencies, fully offline.

```bash
pip install config-guard && config-guard
```

*MCP Tool Search saves tokens. Config Guard saves you from CVEs.*

## License

[MIT](LICENSE) — Copyright (c) 2026 Kaleb Teeter
