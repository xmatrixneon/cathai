// lib/queues/quality-suspend.js
import { Queue } from 'bullmq';
import { getQueueOptions, getJobOptions, getJobInterval } from '../../jobs/utils/job-options.js';

export const suspendQueue = new Queue('quality:suspend', {
  ...getQueueOptions(),
  defaultJobOptions: getJobOptions('quality:suspend'),
});

// Schedule intervals from env or defaults
export const SUSPEND_CHECK_INTERVAL = getJobInterval('quality:suspend_check', 900000); // 15 min
export const SUSPEND_RECOVER_INTERVAL = getJobInterval('quality:suspend_recover', 300000); // 5 min

export async function addSuspendJob(options = {}) {
  const { type = 'suspend-check', delay = 0 } = options;

  return await suspendQueue.add(
    'quality:suspend',
    {
      type,
      runId: crypto.randomUUID(),
      threshold: parseInt(process.env.SMS_SUSPEND_THRESHOLD || '0'),
      windowHours: parseInt(process.env.SMS_SUSPEND_WINDOW_HOURS || '12'),
      testNumber: process.env.SMS_TEST_NUMBER || null,
      dryRun: process.env.SMS_SUSPEND_DRY_RUN === 'true',
      startedAt: Date.now(),
    },
    {
      delay,
    }
  );
}

export async function getSuspendStats() {
  return {
    waiting: await suspendQueue.getWaitingCount(),
    active: await suspendQueue.getActiveCount(),
    completed: await suspendQueue.getCompletedCount(),
    failed: await suspendQueue.getFailedCount(),
    delayed: await suspendQueue.getDelayedCount(),
    workers: await suspendQueue.getWorkersCount(),
  };
}
