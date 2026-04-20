// lib/cache.js - Redis caching layer for API responses
// Reduces database load and improves response times
import { getRedis } from '@/lib/queues/redis';

const CACHE_ENABLED = process.env.CACHE_ENABLED !== 'false';

// Cache TTL constants (in seconds) - Optimized for 62GB RAM system
export const CACHE_TTL = {
  OVERVIEW_STATS: 10,       // 10 seconds - overview statistics (REAL-TIME data)
  DEVICE_LIST: 60,          // 1 minute - device list
  ACTIVE_ORDERS: 30,        // 30 seconds - active orders (high change rate)
  SERVICES_LIST: 3600,      // 1 hour - services rarely change
  COUNTRIES_LIST: 3600,     // 1 hour - countries rarely change
  NUMBERS_LIST: 120,        // 2 minutes - numbers list
  SINGLE_ORDER: 60,         // 1 minute - single order details
  NUMBER_QUALITY: 180,      // 3 minutes - number quality stats
  LOCKS_LIST: 30,           // 30 seconds - number locks
  DASHBOARD_CHARTS: 120,    // 2 minutes - chart data
};

/**
 * Get cached data or fetch fresh data
 * @param {string} key - Cache key
 * @param {Function} fetchFn - Function to fetch fresh data
 * @param {number} ttlSeconds - Time to live in seconds (default: 60)
 * @returns {Promise<any>} - Cached or fresh data
 */
export async function getCached(key, fetchFn, ttlSeconds = 60) {
  if (!CACHE_ENABLED) {
    return fetchFn();
  }

  const redis = getRedis();

  try {
    const cached = await redis.get(key);
    if (cached !== null) {
      console.log(`[Cache HIT] ${key}`);
      return JSON.parse(cached);
    }
  } catch (err) {
    console.error(`[Cache] Get error for key '${key}':`, err);
  }

  console.log(`[Cache MISS] ${key}`);
  const data = await fetchFn();

  try {
    await redis.set(key, JSON.stringify(data), 'EX', ttlSeconds);
  } catch (err) {
    console.error(`[Cache] Set error for key '${key}':`, err);
  }

  return data;
}

/**
 * Invalidate cache keys matching a pattern
 * @param {string} pattern - Redis key pattern (e.g., 'dashboard:*')
 * @returns {Promise<number>} - Number of keys deleted
 */
export async function invalidateCache(pattern) {
  if (!CACHE_ENABLED) {
    return 0;
  }

  const redis = getRedis();

  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
      console.log(`[Cache] Invalidated ${keys.length} keys matching pattern: ${pattern}`);
      return keys.length;
    }
  } catch (err) {
    console.error(`[Cache] Invalidation error for pattern '${pattern}':`, err);
  }

  return 0;
}

/**
 * Set HTTP cache headers on NextResponse
 * @param {NextResponse} res - Next.js response object
 * @param {number} maxAge - Max age in seconds (default: 30)
 */
export function setCacheHeaders(res, maxAge = 30) {
  res.headers.set('Cache-Control', `public, max-age=${maxAge}, stale-while-revalidate=${maxAge * 2}`);
}

/**
 * Delete a specific cache key
 * @param {string} key - Cache key to delete
 * @returns {Promise<boolean>} - True if deleted successfully
 */
export async function deleteCache(key) {
  if (!CACHE_ENABLED) {
    return false;
  }

  const redis = getRedis();

  try {
    await redis.del(key);
    console.log(`[Cache] Deleted key: ${key}`);
    return true;
  } catch (err) {
    console.error(`[Cache] Delete error for key '${key}':`, err);
    return false;
  }
}

/**
 * Get cache status information
 * @returns {Promise<Object>} - Cache status info
 */
export async function getCacheStatus() {
  if (!CACHE_ENABLED) {
    return { enabled: false, status: 'disabled' };
  }

  const redis = getRedis();

  try {
    const info = await redis.info('stats');
    const keyCount = await redis.dbsize();
    return {
      enabled: true,
      status: redis.status,
      keyCount,
      info: info.split('\n').slice(0, 5).join(' ')
    };
  } catch (err) {
    return { enabled: true, status: 'error', error: err.message };
  }
}

/**
 * Generate cache key with parameters
 * @param {string} prefix - Key prefix (e.g., 'orders', 'overview')
 * @param {Object} params - Parameters to include in key
 * @returns {string}
 */
export function buildCacheKey(prefix, params = {}) {
  const parts = [prefix];
  const sortedKeys = Object.keys(params).sort();

  for (const key of sortedKeys) {
    const value = params[key];
    if (value !== undefined && value !== null) {
      parts.push(`${key}:${value}`);
    }
  }

  return parts.join(':');
}

/**
 * Build cache key for paginated queries
 * @param {string} prefix - Key prefix
 * @param {Object} filters - Filter object
 * @param {Object} pagination - Pagination {page, limit, sort}
 * @returns {string}
 */
export function buildPaginatedKey(prefix, filters = {}, pagination = {}) {
  return buildCacheKey(prefix, { ...filters, ...pagination });
}
