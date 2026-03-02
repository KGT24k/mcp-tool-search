# Changelog

All notable changes to mcp-tool-search will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-03-01

### Added
- **LRU Cache** — Configurable in-memory cache for search results (1-min TTL) and tool schemas (no expiry)
  - Hit/miss metrics exposed via `/health` and `/stats` endpoints
  - Automatic cache invalidation on catalog reload
  - LRU eviction when at capacity (128 search entries, 256 schema entries)
- **Exponential backoff retry** — Tool calls retry up to 3 times on transient failures
  - Connection errors (EPIPE, ECONNRESET, Connection closed) trigger reconnect + retry
  - Timeouts (30s per call) trigger fresh connection + retry
  - Jittered backoff: 500ms → 1s → 2s → 4s (capped at 8s)
  - Application errors (bad input, tool logic errors) are NOT retried
- **Gzip compression** — HTTP responses > 1KB auto-compressed when client accepts gzip
- **Enhanced `/health` endpoint** — Now includes version, uptime, memory usage, cache stats, pool connections
- **New `/stats` endpoint** — Detailed monitoring: pool metrics, cache hit rates, catalog breakdown
- 28 new tests (81 total): LRU cache (26 tests), pool retry/backoff (9 tests), catalog cache integration (7 tests)

### Changed
- Server version now tracked via `VERSION` constant (was hardcoded "2.0.0" in multiple places)
- `Catalog.search()` and `Catalog.getToolSchema()` now cache results for faster repeated lookups
- `ServerPool.callTool()` rewritten with timeout wrapper + retry loop (was single-attempt with manual reconnect)
- "Connection closed" (MCP -32000 error) added to retryable error classification

## [1.2.0] - 2026-02-28

### Added
- **Streamable HTTP transport** — run as a remote HTTP server with `MCP_HTTP_PORT=3100` or `--http` flag
  - Session management with unique session IDs per client
  - Health check endpoint at `/health` (returns server stats, tool count, session count)
  - DNS rebinding protection — only allows localhost connections
  - Session cleanup on DELETE requests
  - Enables Smithery hosting, Docker deployments, and remote client connections
- `start:http` npm script for quick HTTP mode startup
- Refactored tool registration into reusable `registerTools()` function

### Changed
- Server version bumped to 2.0.0 (internal MCP protocol version)
- Smithery.yaml updated to v1.2.0

## [1.1.3] - 2026-02-26

### Fixed
- Removed fabricated contact email from SECURITY.md; security reports now use GitHub Security Advisories exclusively

### Changed
- Bumped smithery.yaml version to match package release

## [1.1.2] - 2026-02-26

### Fixed
- Proper `isError` flag on error responses for MCP protocol compliance
- Timer leak cleanup on connection close (idle timeout timers now cleared)
- Environment variable scrubbing for catalog entries (`buildSafeEnv()` hardened)
- Added unhandled promise rejection handler for graceful error recovery

### Added
- SECURITY.md with responsible disclosure policy via GitHub Security Advisories
- GitHub issue templates (bug report, feature request)
- GitHub funding configuration (GitHub Sponsors)

## [1.1.1] - 2026-02-26

### Fixed
- Corrected GitHub repository URLs in npm package metadata (`repository`, `homepage`, `bugs` fields)

### Changed
- Bumped smithery.yaml version to v1.1.1

## [1.1.0] - 2026-02-26

### Added
- Initial public release
- MCP proxy server with 4 tools: `search_tools`, `get_tool_schema`, `call_tool`, `list_servers`
- Fuzzy search engine with Levenshtein distance matching and typo tolerance
- Lazy connection pool with 5-minute idle timeout and auto-reconnect
- Pre-built catalog system (`mcp-build-catalog` CLI)
- `buildSafeEnv()` allowlist-based environment variable filter for secure server spawning
- Connection cap (max 20 concurrent connections, oldest idle evicted)
- 15-second connect timeout on server spawn
- TypeScript strict mode with full type safety
- 36 passing tests with 0 npm audit vulnerabilities
- Smithery registry configuration (`smithery.yaml`)
- Support for Claude Code, Claude Desktop, Cursor, Windsurf, and any stdio MCP client
- Benchmarks documentation (BENCHMARKS.md)
- MIT license

[1.3.0]: https://github.com/KGT24k/mcp-tool-search/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/KGT24k/mcp-tool-search/compare/v1.1.3...v1.2.0
[1.1.3]: https://github.com/KGT24k/mcp-tool-search/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/KGT24k/mcp-tool-search/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/KGT24k/mcp-tool-search/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/KGT24k/mcp-tool-search/releases/tag/v1.1.0
