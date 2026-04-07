// lib/queues/device-keepalive.js
import { Queue } from 'bullmq';
import { getQueueOptions, getJobOptions, getJobInterval } from '../../jobs/utils/job-options.js';

export const keepaliveQueue = new Queue('device-keepalive', {
  ...getQueueOptions(),
  defaultJobOptions: getJobOptions('device-keepalive'),
});

// Schedule interval from env or default 30000ms
export const KEEPALIVE_INTERVAL = getJobInterval('device-keepalive', 30000);

export async function addKeepaliveJob(options = {}) {
  const { type = 'scheduled', targetDeviceIds = null, delay = 0 } = options;

  return await keepaliveQueue.add(
    'device-keepalive',
    {
      type,
      runId: crypto.randomUUID(),
      targetDeviceIds,
      startedAt: Date.now(),
    },
    {
      delay,
    }
  );
}

export async function getKeepaliveStats() {
  return {
    waiting: await keepaliveQueue.getWaitingCount(),
    active: await keepaliveQueue.getActiveCount(),
    completed: await keepaliveQueue.getCompletedCount(),
    failed: await keepaliveQueue.getFailedCount(),
    delayed: await keepaliveQueue.getDelayedCount(),
    workers: await keepaliveQueue.getWorkersCount(),
  };
}
