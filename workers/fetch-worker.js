// workers/fetch-worker.js
import { config } from 'dotenv';
import { Worker } from 'bullmq';
import mongoose from 'mongoose';
import connectDB from '../lib/db.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getRedis } from '../lib/queues/redis.js';
import { fetchQueue, FETCH_INTERVAL } from '../lib/queues/sms-fetch.js';
import { handleFetchJob } from '../jobs/handlers/fetch-handler.js';
import { withJobLogging } from '../jobs/utils/job-logger.js';
import { getWorkerConcurrency } from '../jobs/utils/job-options.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Delay to use when scheduling next job after a failure (to prevent rapid retry loops)
const ERROR_RETRY_DELAY = parseInt(process.env.BULLMQ_ERROR_RETRY_DELAY || '30000', 10);

// Global error handlers to prevent worker crashes
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Fetch] Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit - let PM2 restart if needed
});

process.on('uncaughtException', (error) => {
  console.error('[Fetch] Uncaught Exception:', error);
  // Exit to let PM2 restart with clean state
  process.exit(1);
});

// Load environment variables
config({ path: join(__dirname, '..', '.env.local') });
config({ path: join(__dirname, '..', '.env') });

// Check if worker is enabled
if (process.env.BULLMQ_FETCH_ENABLED !== 'true') {
  console.log('[Fetch Worker] Disabled (BULLMQ_FETCH_ENABLED != true)');
  process.exit(0);
}

// Connect to MongoDB before starting worker
await connectDB();

const worker = new Worker('sms-fetch', async (job) => {
  return withJobLogging(job, async () => {
    const result = await handleFetchJob(job.data);

    // Schedule next run for scheduled jobs (regardless of success/failure)
    if (job.data.type === 'scheduled') {
      // Use longer delay on failure to prevent rapid retry loops
      const delay = result.success ? FETCH_INTERVAL : ERROR_RETRY_DELAY;
      await fetchQueue.add(
        'sms-fetch',
        {
          type: 'scheduled',
          runId: crypto.randomUUID(),
          startedAt: Date.now(),
        },
        { delay }
      );
    }

    return result;
  });
}, {
  connection: getRedis(),
  concurrency: getWorkerConcurrency('sms-fetch', 1),
});

worker.on('completed', (job) => {
  console.log(`[Fetch] Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`[Fetch] Job ${job?.id} failed:`, err.message);
});

worker.on('error', (error) => {
  console.error('[Fetch] Worker error:', error.message);
  // Continue processing other jobs
});

// Graceful shutdown
const shutdown = async () => {
  console.log('[Fetch] Shutting down worker...');
  await worker.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('[Fetch] Worker started');
