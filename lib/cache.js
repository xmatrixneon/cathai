// lib/cache.js - Redis caching layer DISABLED for real-time updates
import { getRedis } from '@/lib/queues/redis';

// ALL CACHING DISABLED for real-time updates
const CACHE_ENABLED = false;

// All TTLs set to 0 - caching disabled
export const CACHE_TTL = {
  OVERVIEW_STATS: 0,
  DEVICE_LIST: 0,
  ACTIVE_ORDERS: 0,
  SERVICES_LIST: 0,
  COUNTRIES_LIST: 0,
  NUMBERS_LIST: 0,
  SINGLE_ORDER: 0,
  NUMBER_QUALITY: 0,
  LOCKS_LIST: 0,
  DASHBOARD_CHARTS: 0,
};

/**
 * Get cached data or fetch fresh data - CACHING DISABLED
 * @param {string} key - Cache key (ignored)
 * @param {Function} fetchFn - Function to fetch fresh data
 * @param {number} ttlSeconds - Time to live in seconds (ignored)
 * @returns {Promise<any>} - Fresh data
 */
export async function getCached(key, fetchFn, ttlSeconds = 60) {
  // Always fetch fresh data - caching disabled
  return fetchFn();
}

/**
 * Invalidate cache keys - NOOP (caching disabled)
 * @param {string} pattern - Redis key pattern (ignored)
 * @returns {Promise<number>} - Always 0
 */
export async function invalidateCache(pattern) {
  return 0;
}

/**
 * Set HTTP cache headers - ALWAYS no-cache
 * @param {NextResponse} res - Next.js response object
 * @param {number} maxAge - Max age in seconds (ignored)
 */
export function setCacheHeaders(res, maxAge = 30) {
  // Always disable browser caching
  res.headers.set('Cache-Control', `no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0`);
}

/**
 * Delete a specific cache key - NOOP (caching disabled)
 * @param {string} key - Cache key to delete (ignored)
 * @returns {Promise<boolean>} - Always false
 */
export async function deleteCache(key) {
  return false;
}

/**
 * Get cache status information - Always disabled
 * @returns {Promise<Object>} - Cache disabled status
 */
export async function getCacheStatus() {
  return { enabled: false, status: 'disabled' };
}

/**
 * Generate cache key - Returns empty string (caching disabled)
 * @param {string} prefix - Key prefix (ignored)
 * @param {Object} params - Parameters (ignored)
 * @returns {string} - Empty string
 */
export function buildCacheKey(prefix, params = {}) {
  return '';
}

/**
 * Build cache key for paginated queries - Returns empty string (caching disabled)
 * @param {string} prefix - Key prefix (ignored)
 * @param {Object} filters - Filter object (ignored)
 * @param {Object} pagination - Pagination (ignored)
 * @returns {string} - Empty string
 */
export function buildPaginatedKey(prefix, filters = {}, pagination = {}) {
  return '';
}
