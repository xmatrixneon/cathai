// lib/queues/device-wakeup.js
import { Queue } from 'bullmq';
import { getQueueOptions, getJobOptions, getJobInterval } from '../../jobs/utils/job-options.js';

export const wakeupQueue = new Queue('device-wakeup', {
  ...getQueueOptions(),
  defaultJobOptions: getJobOptions('device-wakeup'),
});

// Schedule interval from env or default 120000ms
export const WAKEUP_INTERVAL = getJobInterval('device-wakeup', 120000);

export async function addWakeupJob(options = {}) {
  const { type = 'scheduled', targetDeviceId = null, maxAttempts = 3, delay = 0 } = options;

  return await wakeupQueue.add(
    'device-wakeup',
    {
      type,
      runId: crypto.randomUUID(),
      targetDeviceId,
      maxAttempts,
      startedAt: Date.now(),
    },
    {
      delay,
    }
  );
}

export async function getWakeupStats() {
  return {
    waiting: await wakeupQueue.getWaitingCount(),
    active: await wakeupQueue.getActiveCount(),
    completed: await wakeupQueue.getCompletedCount(),
    failed: await wakeupQueue.getFailedCount(),
    delayed: await wakeupQueue.getDelayedCount(),
    workers: await wakeupQueue.getWorkersCount(),
  };
}
