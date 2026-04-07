// lib/queues/device-status.js
import { Queue } from 'bullmq';
import { getQueueOptions, getJobOptions, getJobInterval } from '../../jobs/utils/job-options.js';

export const statusQueue = new Queue('device-status', {
  ...getQueueOptions(),
  defaultJobOptions: getJobOptions('device-status'),
});

// Schedule interval from env or default 15000ms
export const STATUS_INTERVAL = getJobInterval('device-status', 15000);

export async function addStatusJob(options = {}) {
  const { type = 'scheduled', fullSync = false, delay = 0 } = options;

  return await statusQueue.add(
    'device-status',
    {
      type,
      runId: crypto.randomUUID(),
      fullSync,
      startedAt: Date.now(),
    },
    {
      delay,
    }
  );
}

export async function getStatusStats() {
  return {
    waiting: await statusQueue.getWaitingCount(),
    active: await statusQueue.getActiveCount(),
    completed: await statusQueue.getCompletedCount(),
    failed: await statusQueue.getFailedCount(),
    delayed: await statusQueue.getDelayedCount(),
    workers: await statusQueue.getWorkersCount(),
  };
}
