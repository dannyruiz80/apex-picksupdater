import { MarketCacheStats } from '../types';

interface CacheEntry<T> {
  data: T;
  cachedAt: number; // timestamp ms
  expiresAt: number; // timestamp ms
  key: string;
}

class MarketCacheService {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private inFlightRequests: Map<string, Promise<any>> = new Map();
  private cacheHits: number = 0;
  private cacheMisses: number = 0;
  private duplicateRequestsPrevented: number = 0;

  // Generate deterministic cache key
  public generateKey(params: {
    sport: string;
    league?: string;
    eventId?: string;
    marketType?: string;
    date?: string;
  }): string {
    const parts = [
      params.sport.toUpperCase(),
      (params.league || 'ALL').toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
      params.eventId || 'SLATE',
      params.marketType || 'ALL',
      params.date || 'TODAY',
    ];
    return parts.join('::');
  }

  public get<T>(key: string): { hit: boolean; data: T | null } {
    const entry = this.cache.get(key);
    if (!entry) {
      this.cacheMisses++;
      return { hit: false, data: null };
    }

    const now = Date.now();
    if (now > entry.expiresAt) {
      this.cache.delete(key);
      this.cacheMisses++;
      return { hit: false, data: null };
    }

    this.cacheHits++;
    return { hit: true, data: entry.data as T };
  }

  public set<T>(key: string, data: T, ttlSeconds: number = 300): void {
    const now = Date.now();
    this.cache.set(key, {
      data,
      cachedAt: now,
      expiresAt: now + ttlSeconds * 1000,
      key,
    });
  }

  /**
   * Deduplicates simultaneous identical in-flight requests.
   * If a fetch for `key` is already pending, all concurrent callers await the single promise.
   */
  public async getOrFetch<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttlSeconds: number = 300
  ): Promise<{ data: T; status: 'HIT' | 'MISS' | 'DEDUPED' }> {
    // 1. Check cache first
    const cached = this.get<T>(key);
    if (cached.hit && cached.data !== null) {
      return { data: cached.data, status: 'HIT' };
    }

    // 2. Check in-flight deduplication
    if (this.inFlightRequests.has(key)) {
      this.duplicateRequestsPrevented++;
      try {
        const dedupedData = await this.inFlightRequests.get(key)!;
        return { data: dedupedData as T, status: 'DEDUPED' };
      } catch (err) {
        // If in-flight failed, proceed to try fresh or throw
        throw err;
      }
    }

    // 3. Initiate single in-flight fetch
    const promise = (async () => {
      try {
        const freshData = await fetchFn();
        this.set(key, freshData, ttlSeconds);
        return freshData;
      } finally {
        this.inFlightRequests.delete(key);
      }
    })();

    this.inFlightRequests.set(key, promise);
    const result = await promise;
    return { data: result, status: 'MISS' };
  }

  public clear(): void {
    this.cache.clear();
    this.inFlightRequests.clear();
  }

  public getStats(): MarketCacheStats {
    // Clean expired entries when reading stats
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }

    return {
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      duplicateRequestsPrevented: this.duplicateRequestsPrevented,
      activeEntriesCount: this.cache.size,
    };
  }
}

export const marketCache = new MarketCacheService();
