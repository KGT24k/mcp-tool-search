/**
 * MCP Tool Search — LRU Cache with TTL
 *
 * Generic cache implementation for search results, tool schemas,
 * and server metadata. Features:
 *
 * - Least Recently Used eviction when maxEntries is reached
 * - Time-based expiration (configurable TTL per cache)
 * - Hit/miss metrics for monitoring
 * - Zero external dependencies
 */

export interface CacheOptions {
  /** Maximum number of entries before LRU eviction (default: 256) */
  maxEntries?: number;
  /** Time-to-live in milliseconds (default: 300_000 = 5 min). 0 = no expiry. */
  ttlMs?: number;
}

interface CacheEntry<V> {
  value: V;
  createdAt: number;
  lastAccessed: number;
}

export interface CacheStats {
  size: number;
  maxEntries: number;
  ttlMs: number;
  hits: number;
  misses: number;
  evictions: number;
  hitRate: number;
}

export class LRUCache<V> {
  private readonly store = new Map<string, CacheEntry<V>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  // Metrics
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(options: CacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 256;
    this.ttlMs = options.ttlMs ?? 300_000; // 5 minutes
  }

  /** Get a value from the cache. Returns undefined on miss or expiry. */
  get(key: string): V | undefined {
    const entry = this.store.get(key);

    if (!entry) {
      this.misses++;
      return undefined;
    }

    // Check TTL expiration
    if (this.ttlMs > 0 && Date.now() - entry.createdAt > this.ttlMs) {
      this.store.delete(key);
      this.misses++;
      return undefined;
    }

    // Move to end (most recently used) by re-inserting
    this.store.delete(key);
    entry.lastAccessed = Date.now();
    this.store.set(key, entry);
    this.hits++;

    return entry.value;
  }

  /** Set a value in the cache. Evicts LRU entry if at capacity. */
  set(key: string, value: V): void {
    // If key already exists, delete it first (to update insertion order)
    if (this.store.has(key)) {
      this.store.delete(key);
    }

    // Evict LRU (first entry in Map) if at capacity
    if (this.store.size >= this.maxEntries) {
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) {
        this.store.delete(firstKey);
        this.evictions++;
      }
    }

    const now = Date.now();
    this.store.set(key, {
      value,
      createdAt: now,
      lastAccessed: now,
    });
  }

  /** Check if a key exists and is not expired */
  has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (this.ttlMs > 0 && Date.now() - entry.createdAt > this.ttlMs) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  /** Delete a specific key */
  delete(key: string): boolean {
    return this.store.delete(key);
  }

  /** Clear all entries and reset metrics */
  clear(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  /** Number of entries currently in cache */
  get size(): number {
    return this.store.size;
  }

  /** Get cache statistics */
  stats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      size: this.store.size,
      maxEntries: this.maxEntries,
      ttlMs: this.ttlMs,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  /** Purge all expired entries. Returns number of entries purged. */
  purgeExpired(): number {
    if (this.ttlMs === 0) return 0;

    const now = Date.now();
    let purged = 0;

    for (const [key, entry] of this.store) {
      if (now - entry.createdAt > this.ttlMs) {
        this.store.delete(key);
        purged++;
      }
    }

    return purged;
  }

  /** Get all keys (for debugging/testing) */
  keys(): string[] {
    return Array.from(this.store.keys());
  }
}
