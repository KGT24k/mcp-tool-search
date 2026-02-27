# MCP Tool Search — Token Savings Benchmarks

## Context Token Reduction

MCP Tool Search replaces all backend tool schemas with 4 lightweight proxy tools, drastically reducing the context token overhead.

### Methodology

Token counts measured by counting tool definition JSON characters and dividing by 4 (approximate tokens). Actual savings depend on schema complexity and model tokenizer.

### Results

| Configuration | Tool Schemas Loaded | Est. Context Tokens | Savings vs Direct |
|---|---|---|---|
| **Direct (3 servers, 42 tools)** | 42 | ~8,400 | baseline |
| **MCP Tool Search Proxy** | 4 | ~600 | **~93%** |
| **Direct (10 servers, 100+ tools)** | 100+ | ~20,000+ | baseline |
| **MCP Tool Search Proxy** | 4 | ~600 | **~97%** |

### How It Works

1. **Without proxy:** Every MCP tool's full JSON schema is loaded into the model's context window at session start. With 42 tools, that's ~8,400 tokens of schema definitions the model must process on every turn.

2. **With proxy:** Only 4 tool schemas are loaded (~600 tokens). The model searches for tools on-demand, retrieves schemas just-in-time, and calls them through the proxy.

### Scaling

The proxy's token footprint is **constant** (4 tools) regardless of how many backend servers and tools exist. Adding more MCP servers increases the catalog size on disk but not the context overhead.

| Backend Tools | Direct Tokens | Proxy Tokens | Savings |
|---|---|---|---|
| 10 | ~2,000 | ~600 | 70% |
| 25 | ~5,000 | ~600 | 88% |
| 50 | ~10,000 | ~600 | 94% |
| 100 | ~20,000 | ~600 | 97% |
| 200 | ~40,000 | ~600 | 99% |

### Trade-offs

- **Latency:** Each tool call requires an extra search + schema lookup step (~2 additional LLM turns for first use of a tool).
- **Discovery:** The model must search for tools instead of seeing them all upfront. Good for large catalogs, minor overhead for small ones.
- **Connection management:** Servers are lazily spawned and kept alive for 5 minutes after last use, so first calls to a new server have connection overhead.

### When to Use

- **Use the proxy** when you have 5+ MCP servers or 20+ total tools
- **Use direct connections** when you have 1-2 servers with few tools

### Measurement Date

February 2026 — Tested with Claude Code (Claude Opus 4.6) on Windows 10 with 3 backend MCP servers (42 tools total).
