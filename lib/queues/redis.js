// lib/queues/redis.js
import Redis from 'ioredis';

let redisInstance = null;

export function getRedis() {
  if (!redisInstance) {
    const redisUrl = process.env.REDIS_URI || 'redis://localhost:6379';
    const redisDb = parseInt(process.env.REDIS_DB || '0');
    const maxRetries = parseInt(process.env.REDIS_MAX_RETRIES_PER_REQUEST || '3');

    redisInstance = new Redis(redisUrl, {
      db: redisDb,
      maxRetriesPerRequest: maxRetries,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      enableReadyCheck: true,
    });

    redisInstance.on('error', (err) => {
      console.error('[Redis] Connection error:', err);
    });

    redisInstance.on('connect', () => {
      console.log('[Redis] Connected');
    });

    redisInstance.on('ready', () => {
      console.log('[Redis] Ready');
    });
  }

  return redisInstance;
}

export async function closeRedis() {
  if (redisInstance) {
    await redisInstance.quit();
    redisInstance = null;
  }
}

export function getRedisStatus() {
  return {
    connected: redisInstance?.status === 'ready',
    status: redisInstance?.status || 'not_initialized'
  };
}
