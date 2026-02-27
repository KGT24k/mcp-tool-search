/**
 * MCP Tool Search — Utils Test Suite
 *
 * Tests for buildSafeEnv and resolveCommand shared utilities.
 * Run via: npm test
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildSafeEnv, resolveCommand, IS_WINDOWS } from "../utils.js";

describe("buildSafeEnv", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    // Snapshot env vars we'll modify
    savedEnv = {
      PATH: process.env.PATH,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      SECRET_TOKEN: process.env.SECRET_TOKEN,
    };
  });

  afterEach(() => {
    // Restore env
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  it("should include PATH in filtered env", () => {
    const env = buildSafeEnv();
    assert.ok(env.PATH, "PATH should be present in safe env");
  });

  it("should NOT include ANTHROPIC_API_KEY", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key-12345";
    const env = buildSafeEnv();
    assert.equal(
      env.ANTHROPIC_API_KEY,
      undefined,
      "ANTHROPIC_API_KEY should be filtered out"
    );
  });

  it("should NOT include OPENROUTER_API_KEY", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test-key-12345";
    const env = buildSafeEnv();
    assert.equal(
      env.OPENROUTER_API_KEY,
      undefined,
      "OPENROUTER_API_KEY should be filtered out"
    );
  });

  it("should NOT include arbitrary SECRET_TOKEN", () => {
    process.env.SECRET_TOKEN = "super-secret";
    const env = buildSafeEnv();
    assert.equal(
      env.SECRET_TOKEN,
      undefined,
      "SECRET_TOKEN should be filtered out"
    );
  });

  it("should merge server-specific env vars", () => {
    const env = buildSafeEnv({ MY_SERVER_KEY: "allowed-value" });
    assert.equal(
      env.MY_SERVER_KEY,
      "allowed-value",
      "Server-specific env should be passed through"
    );
  });

  it("should allow server env to override safe keys", () => {
    const env = buildSafeEnv({ NODE_ENV: "test" });
    assert.equal(
      env.NODE_ENV,
      "test",
      "Server env should override safe defaults"
    );
  });

  it("should return empty-ish object when no env matches", () => {
    // Can't easily clear all safe keys, but verify it doesn't crash
    const env = buildSafeEnv();
    assert.ok(typeof env === "object");
  });
});

describe("resolveCommand", () => {
  it("should return 'node' unchanged on any platform", () => {
    assert.equal(resolveCommand("node"), "node");
  });

  it("should return 'python' unchanged on any platform", () => {
    assert.equal(resolveCommand("python"), "python");
  });

  if (IS_WINDOWS) {
    it("should add .cmd suffix to npx on Windows", () => {
      assert.equal(resolveCommand("npx"), "npx.cmd");
    });

    it("should add .cmd suffix to npm on Windows", () => {
      assert.equal(resolveCommand("npm"), "npm.cmd");
    });

    it("should add .cmd suffix to pnpm on Windows", () => {
      assert.equal(resolveCommand("pnpm"), "pnpm.cmd");
    });

    it("should add .cmd suffix to yarn on Windows", () => {
      assert.equal(resolveCommand("yarn"), "yarn.cmd");
    });

    it("should add .cmd suffix to bunx on Windows", () => {
      assert.equal(resolveCommand("bunx"), "bunx.cmd");
    });
  } else {
    it("should NOT add .cmd suffix to npx on non-Windows", () => {
      assert.equal(resolveCommand("npx"), "npx");
    });
  }
});
