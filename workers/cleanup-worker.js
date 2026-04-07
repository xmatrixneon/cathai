// workers/cleanup-worker.js
import { Worker } from 'bullmq';
import { getRedis } from '../lib/queues/redis.js';
import { cleanupQueue, CLEANUP_INTERVAL } from '../lib/queues/maintenance-cleanup.js';
import { handleCleanupJob } from '../jobs/handlers/cleanup-handler.js';
import { withJobLogging } from '../jobs/utils/job-logger.js';
import { getWorkerConcurrency } from '../jobs/utils/job-options.js';

// Check if worker is enabled
if (process.env.BULLMQ_CLEANUP_ENABLED !== 'true') {
  console.log('[Cleanup Worker] Disabled (BULLMQ_CLEANUP_ENABLED != true)');
  process.exit(0);
}

const worker = new Worker('maintenance:cleanup', async (job) => {
  return withJobLogging(job, async () => {
    const result = await handleCleanupJob(job.data);

    // Schedule next run if this was a scheduled job and successful
    if (job.data.type === 'scheduled' && result.success) {
      await cleanupQueue.add(
        'maintenance:cleanup',
        {
          type: 'scheduled',
          runId: crypto.randomUUID(),
          startedAt: Date.now(),
          ...job.data,
        },
        { delay: CLEANUP_INTERVAL }
      );
    }

    return result;
  });
}, {
  connection: getRedis(),
  concurrency: getWorkerConcurrency('maintenance:cleanup', 1),
});

worker.on('completed', (job) => {
  console.log(`[Cleanup] Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`[Cleanup] Job ${job?.id} failed:`, err.message);
});

// Graceful shutdown
const shutdown = async () => {
  console.log('[Cleanup] Shutting down worker...');
  await worker.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('[Cleanup] Worker started');
