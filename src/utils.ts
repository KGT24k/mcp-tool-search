/**
 * MCP Tool Search — Shared Utilities
 * Common helpers used by both catalog builder and connection pool.
 */

/** Whether we're running on Windows */
export const IS_WINDOWS = process.platform === "win32";

/**
 * Environment variables safe to pass to child processes.
 * Allowlist approach: only these keys are forwarded from the parent process.
 * This prevents leaking API keys (ANTHROPIC_API_KEY, OPENROUTER_API_KEY, etc.)
 * to spawned MCP servers.
 */
const SAFE_ENV_KEYS = [
  "PATH",
  "PATHEXT",
  "HOME",
  "USERPROFILE",
  "TEMP",
  "TMP",
  "APPDATA",
  "LOCALAPPDATA",
  "SystemRoot",
  "COMSPEC",
  "NODE_PATH",
  "NODE_ENV",
  "LANG",
  "LC_ALL",
  "TERM",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "WINDIR",
];

/**
 * Build a safe environment for child processes.
 * Filters process.env to only safe keys, then merges server-specific env vars.
 * Server-specific env vars (from catalog config) are always passed through —
 * they are explicitly declared by the user for that server.
 */
export function buildSafeEnv(
  serverEnv?: Record<string, string>
): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key]) filtered[key] = process.env[key]!;
  }
  if (serverEnv) Object.assign(filtered, serverEnv);
  return filtered;
}

/**
 * Resolve commands for Windows compatibility.
 * On Windows, bare npx/npm/pnpm fail in child_process.spawn()
 * without the .cmd extension because PATH resolution differs.
 *
 * @param command - The command to resolve (e.g. "npx", "node")
 * @returns The resolved command (e.g. "npx.cmd" on Windows, "npx" on others)
 */
export function resolveCommand(command: string): string {
  if (!IS_WINDOWS) return command;

  // Commands that need .cmd suffix on Windows for child_process.spawn()
  const cmdSuffixNeeded = ["npx", "npm", "pnpm", "yarn", "bunx"];
  if (cmdSuffixNeeded.includes(command)) {
    return `${command}.cmd`;
  }

  // Already an absolute path or doesn't need resolution
  return command;
}
