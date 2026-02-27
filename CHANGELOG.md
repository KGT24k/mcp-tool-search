# Changelog

All notable changes to mcp-tool-search will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.1.3]: https://github.com/KGT24k/mcp-tool-search/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/KGT24k/mcp-tool-search/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/KGT24k/mcp-tool-search/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/KGT24k/mcp-tool-search/releases/tag/v1.1.0
