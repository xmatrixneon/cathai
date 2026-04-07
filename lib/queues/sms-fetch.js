// lib/queues/sms-fetch.js
import { Queue } from 'bullmq';
import { getQueueOptions, getJobOptions, getJobInterval } from '../../jobs/utils/job-options.js';

export const fetchQueue = new Queue('sms-fetch', {
  ...getQueueOptions(),
  defaultJobOptions: getJobOptions('sms-fetch'),
});

// Schedule interval from env or default 5000ms
export const FETCH_INTERVAL = getJobInterval('sms-fetch', 5000);

export async function addFetchJob(options = {}) {
  const { type = 'scheduled', delay = 0 } = options;

  return await fetchQueue.add(
    'sms-fetch',
    {
      type,
      runId: crypto.randomUUID(),
      startedAt: Date.now(),
    },
    {
      delay,
    }
  );
}

export async function getFetchStats() {
  return {
    waiting: await fetchQueue.getWaitingCount(),
    active: await fetchQueue.getActiveCount(),
    completed: await fetchQueue.getCompletedCount(),
    failed: await fetchQueue.getFailedCount(),
    delayed: await fetchQueue.getDelayedCount(),
    workers: await fetchQueue.getWorkersCount(),
  };
}
