# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 1.1.x   | :white_check_mark: |
| < 1.1   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in mcp-tool-search, please report it responsibly:

1. **Do NOT open a public GitHub issue** for security vulnerabilities
2. **Email:** Send details to kalebteeter@gmail.com with subject "mcp-tool-search Security"
3. **Include:**
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

## Response Timeline

- **Acknowledgment:** Within 48 hours
- **Initial assessment:** Within 1 week
- **Fix release:** Within 2 weeks for critical issues

## Security Practices

This project follows these security practices:

- **Dependency auditing:** `npm audit` run before every release
- **Env var protection:** `buildSafeEnv()` allowlist prevents leaking API keys to child processes
- **Catalog scrubbing:** Secret-like env values are redacted in catalog.json
- **No eval/exec:** No dynamic code execution anywhere in the codebase
- **Input sanitization:** Search queries are tokenized and stripped of special characters
- **Connection isolation:** Each MCP server connection is isolated in its own process

## Scope

The following are in scope for security reports:

- Token/credential exposure via catalog.json or environment
- Command injection through tool parameters
- Unauthorized access to MCP server connections
- Denial of service through resource exhaustion

The following are out of scope:

- Security of upstream MCP servers (report to those projects)
- Local privilege escalation (this is a CLI tool run by the user)
