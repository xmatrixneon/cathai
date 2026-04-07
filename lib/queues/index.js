// lib/queues/index.js
import { fetchQueue, addFetchJob, getFetchStats, FETCH_INTERVAL } from './sms-fetch.js';
import { statusQueue, addStatusJob, getStatusStats, STATUS_INTERVAL } from './device-status.js';
import { keepaliveQueue, addKeepaliveJob, getKeepaliveStats, KEEPALIVE_INTERVAL } from './device-keepalive.js';
import { wakeupQueue, addWakeupJob, getWakeupStats, WAKEUP_INTERVAL } from './device-wakeup.js';
import { suspendQueue, addSuspendJob, getSuspendStats, SUSPEND_CHECK_INTERVAL, SUSPEND_RECOVER_INTERVAL } from './quality-suspend.js';
import { cleanupQueue, addCleanupJob, getCleanupStats, CLEANUP_INTERVAL } from './maintenance-cleanup.js';
import { getRedis, closeRedis, getRedisStatus } from './redis.js';

export { getRedis, closeRedis, getRedisStatus };
export { fetchQueue, addFetchJob, getFetchStats, FETCH_INTERVAL };
export { statusQueue, addStatusJob, getStatusStats, STATUS_INTERVAL };
export { keepaliveQueue, addKeepaliveJob, getKeepaliveStats, KEEPALIVE_INTERVAL };
export { wakeupQueue, addWakeupJob, getWakeupStats, WAKEUP_INTERVAL };
export { suspendQueue, addSuspendJob, getSuspendStats, SUSPEND_CHECK_INTERVAL, SUSPEND_RECOVER_INTERVAL };
export { cleanupQueue, addCleanupJob, getCleanupStats, CLEANUP_INTERVAL };

// Get all queues as array for iteration
export function getAllQueues() {
  return [
    { name: 'sms-fetch', queue: fetchQueue, getStats: getFetchStats },
    { name: 'device-status', queue: statusQueue, getStats: getStatusStats },
    { name: 'device-keepalive', queue: keepaliveQueue, getStats: getKeepaliveStats },
    { name: 'device-wakeup', queue: wakeupQueue, getStats: getWakeupStats },
    { name: 'quality-suspend', queue: suspendQueue, getStats: getSuspendStats },
    { name: 'maintenance-cleanup', queue: cleanupQueue, getStats: getCleanupStats },
  ];
}

// Get queue by name
export function getQueueByName(queueName) {
  const queues = getAllQueues();
  return queues.find(q => q.name === queueName)?.queue;
}

// Close all queues (for graceful shutdown)
export async function closeAllQueues() {
  await Promise.all([
    fetchQueue.close(),
    statusQueue.close(),
    keepaliveQueue.close(),
    wakeupQueue.close(),
    suspendQueue.close(),
    cleanupQueue.close(),
  ]);
}
