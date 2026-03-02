/**
 * MCP Tool Search — LRU Cache Test Suite
 *
 * Tests for the generic LRU cache with TTL.
 * Run via: npm test
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { LRUCache } from "../cache.js";

describe("LRUCache", () => {
  let cache: LRUCache<string>;

  beforeEach(() => {
    cache = new LRUCache<string>({ maxEntries: 3, ttlMs: 0 }); // No TTL for basic tests
  });

  // ─── Basic Operations ────────────────────────────────────────
  describe("get/set", () => {
    it("should store and retrieve a value", () => {
      cache.set("key1", "value1");
      assert.equal(cache.get("key1"), "value1");
    });

    it("should return undefined for missing key", () => {
      assert.equal(cache.get("nonexistent"), undefined);
    });

    it("should overwrite existing key", () => {
      cache.set("key1", "original");
      cache.set("key1", "updated");
      assert.equal(cache.get("key1"), "updated");
      assert.equal(cache.size, 1);
    });

    it("should track size correctly", () => {
      cache.set("a", "1");
      cache.set("b", "2");
      cache.set("c", "3");
      assert.equal(cache.size, 3);
    });
  });

  // ─── LRU Eviction ───────────────────────────────────────────
  describe("LRU eviction", () => {
    it("should evict least recently used entry when at capacity", () => {
      cache.set("a", "1");
      cache.set("b", "2");
      cache.set("c", "3");
      // At capacity (3). Adding a 4th should evict "a" (oldest)
      cache.set("d", "4");
      assert.equal(cache.size, 3);
      assert.equal(cache.get("a"), undefined, "LRU entry 'a' should be evicted");
      assert.equal(cache.get("b"), "2");
      assert.equal(cache.get("d"), "4");
    });

    it("should promote accessed entries (not evict recently used)", () => {
      cache.set("a", "1");
      cache.set("b", "2");
      cache.set("c", "3");
      // Access "a" to make it recently used
      cache.get("a");
      // Now "b" is the LRU, adding "d" should evict "b"
      cache.set("d", "4");
      assert.equal(cache.get("a"), "1", "'a' was accessed, should not be evicted");
      assert.equal(cache.get("b"), undefined, "'b' should be evicted as LRU");
    });

    it("should count evictions in stats", () => {
      cache.set("a", "1");
      cache.set("b", "2");
      cache.set("c", "3");
      cache.set("d", "4"); // evicts "a"
      cache.set("e", "5"); // evicts "b"
      const stats = cache.stats();
      assert.equal(stats.evictions, 2);
    });
  });

  // ─── TTL Expiration ─────────────────────────────────────────
  describe("TTL expiration", () => {
    it("should expire entries after TTL", async () => {
      const shortCache = new LRUCache<string>({ maxEntries: 10, ttlMs: 50 });
      shortCache.set("key1", "value1");
      assert.equal(shortCache.get("key1"), "value1", "Should be present immediately");

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.equal(shortCache.get("key1"), undefined, "Should be expired after TTL");
    });

    it("should not expire when ttlMs is 0", () => {
      const noTtlCache = new LRUCache<string>({ maxEntries: 10, ttlMs: 0 });
      noTtlCache.set("key1", "value1");
      // Even though we can't wait forever, ttlMs=0 means no check
      assert.equal(noTtlCache.get("key1"), "value1");
    });

    it("should count expired entry as miss", async () => {
      const shortCache = new LRUCache<string>({ maxEntries: 10, ttlMs: 50 });
      shortCache.set("key1", "value1");
      shortCache.get("key1"); // hit
      await new Promise((resolve) => setTimeout(resolve, 60));
      shortCache.get("key1"); // miss (expired)
      const stats = shortCache.stats();
      assert.equal(stats.hits, 1);
      assert.equal(stats.misses, 1);
    });
  });

  // ─── has / delete / clear ───────────────────────────────────
  describe("has", () => {
    it("should return true for existing key", () => {
      cache.set("key1", "value1");
      assert.equal(cache.has("key1"), true);
    });

    it("should return false for missing key", () => {
      assert.equal(cache.has("nonexistent"), false);
    });

    it("should return false for expired key", async () => {
      const shortCache = new LRUCache<string>({ maxEntries: 10, ttlMs: 50 });
      shortCache.set("key1", "value1");
      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.equal(shortCache.has("key1"), false);
    });
  });

  describe("delete", () => {
    it("should remove a specific key", () => {
      cache.set("key1", "value1");
      const deleted = cache.delete("key1");
      assert.equal(deleted, true);
      assert.equal(cache.get("key1"), undefined);
      assert.equal(cache.size, 0);
    });

    it("should return false for missing key", () => {
      assert.equal(cache.delete("nonexistent"), false);
    });
  });

  describe("clear", () => {
    it("should remove all entries and reset metrics", () => {
      cache.set("a", "1");
      cache.set("b", "2");
      cache.get("a"); // hit
      cache.get("missing"); // miss
      cache.clear();
      assert.equal(cache.size, 0);
      const stats = cache.stats();
      assert.equal(stats.hits, 0);
      assert.equal(stats.misses, 0);
      assert.equal(stats.evictions, 0);
    });
  });

  // ─── purgeExpired ───────────────────────────────────────────
  describe("purgeExpired", () => {
    it("should purge only expired entries", async () => {
      const shortCache = new LRUCache<string>({ maxEntries: 10, ttlMs: 50 });
      shortCache.set("old1", "value1");
      shortCache.set("old2", "value2");
      await new Promise((resolve) => setTimeout(resolve, 60));
      shortCache.set("new1", "value3"); // Added after TTL wait — still fresh
      const purged = shortCache.purgeExpired();
      assert.equal(purged, 2);
      assert.equal(shortCache.size, 1);
      assert.equal(shortCache.get("new1"), "value3");
    });

    it("should return 0 when ttlMs is 0", () => {
      cache.set("a", "1");
      assert.equal(cache.purgeExpired(), 0);
    });
  });

  // ─── Stats / Metrics ───────────────────────────────────────
  describe("stats", () => {
    it("should track hits and misses", () => {
      cache.set("a", "1");
      cache.get("a"); // hit
      cache.get("a"); // hit
      cache.get("b"); // miss
      const stats = cache.stats();
      assert.equal(stats.hits, 2);
      assert.equal(stats.misses, 1);
    });

    it("should compute hit rate correctly", () => {
      cache.set("a", "1");
      cache.get("a"); // hit
      cache.get("b"); // miss
      cache.get("a"); // hit
      const stats = cache.stats();
      // 2 hits / 3 total = 0.6667
      assert.ok(Math.abs(stats.hitRate - 2 / 3) < 0.001);
    });

    it("should return 0 hit rate when no operations", () => {
      const stats = cache.stats();
      assert.equal(stats.hitRate, 0);
    });

    it("should report maxEntries and ttlMs", () => {
      const stats = cache.stats();
      assert.equal(stats.maxEntries, 3);
      assert.equal(stats.ttlMs, 0);
    });
  });

  // ─── keys ──────────────────────────────────────────────────
  describe("keys", () => {
    it("should return all current keys", () => {
      cache.set("x", "1");
      cache.set("y", "2");
      const keys = cache.keys();
      assert.deepEqual(keys.sort(), ["x", "y"]);
    });

    it("should return empty array for empty cache", () => {
      assert.deepEqual(cache.keys(), []);
    });
  });

  // ─── Edge Cases ────────────────────────────────────────────
  describe("edge cases", () => {
    it("should handle maxEntries of 1", () => {
      const tiny = new LRUCache<number>({ maxEntries: 1, ttlMs: 0 });
      tiny.set("a", 1);
      tiny.set("b", 2); // evicts "a"
      assert.equal(tiny.get("a"), undefined);
      assert.equal(tiny.get("b"), 2);
      assert.equal(tiny.size, 1);
    });

    it("should handle empty string key", () => {
      cache.set("", "empty-key-value");
      assert.equal(cache.get(""), "empty-key-value");
    });

    it("should handle complex values", () => {
      const objCache = new LRUCache<{ data: number[] }>({ maxEntries: 5 });
      objCache.set("arr", { data: [1, 2, 3] });
      const result = objCache.get("arr");
      assert.deepEqual(result, { data: [1, 2, 3] });
    });

    it("should use default options when none provided", () => {
      const defaults = new LRUCache<string>();
      const stats = defaults.stats();
      assert.equal(stats.maxEntries, 256);
      assert.equal(stats.ttlMs, 300_000);
    });
  });
});
