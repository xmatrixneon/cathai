// lib/queues/maintenance-cleanup.js
import { Queue } from 'bullmq';
import { getQueueOptions, getJobOptions, getJobInterval } from '../../jobs/utils/job-options.js';

export const cleanupQueue = new Queue('maintenance:cleanup', {
  ...getQueueOptions(),
  defaultJobOptions: getJobOptions('maintenance:cleanup'),
});

// Schedule interval from env or default 21600000ms (6 hours)
export const CLEANUP_INTERVAL = getJobInterval('maintenance:cleanup', 21600000);

export async function addCleanupJob(options = {}) {
  const { type = 'scheduled', delay = 0 } = options;

  return await cleanupQueue.add(
    'maintenance:cleanup',
    {
      type,
      runId: crypto.randomUUID(),
      retentionHours: parseInt(process.env.MESSAGE_RETENTION_HOURS || '12'),
      batchSize: parseInt(process.env.MESSAGE_CLEANUP_BATCH_SIZE || '1000'),
      dryRun: process.env.MESSAGE_CLEANUP_DRY_RUN === 'false' ? false : true,
      startedAt: Date.now(),
    },
    {
      delay,
    }
  );
}

export async function getCleanupStats() {
  return {
    waiting: await cleanupQueue.getWaitingCount(),
    active: await cleanupQueue.getActiveCount(),
    completed: await cleanupQueue.getCompletedCount(),
    failed: await cleanupQueue.getFailedCount(),
    delayed: await cleanupQueue.getDelayedCount(),
    workers: await cleanupQueue.getWorkersCount(),
  };
}
