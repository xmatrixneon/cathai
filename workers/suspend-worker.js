// workers/suspend-worker.js
import { config } from 'dotenv';
import { Worker } from 'bullmq';
import mongoose from 'mongoose';
import connectDB from '../lib/db.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getRedis } from '../lib/queues/redis.js';
import { suspendQueue, SUSPEND_CHECK_INTERVAL, SUSPEND_RECOVER_INTERVAL } from '../lib/queues/quality-suspend.js';
import { handleSuspendJob } from '../jobs/handlers/suspend-handler.js';
import { withJobLogging } from '../jobs/utils/job-logger.js';
import { getWorkerConcurrency } from '../jobs/utils/job-options.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Delay to use when scheduling next job after a failure (to prevent rapid retry loops)
const ERROR_RETRY_DELAY = parseInt(process.env.BULLMQ_ERROR_RETRY_DELAY || '30000', 10);

// Global error handlers to prevent worker crashes
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Suspend] Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit - let PM2 restart if needed
});

process.on('uncaughtException', (error) => {
  console.error('[Suspend] Uncaught Exception:', error);
  // Exit to let PM2 restart with clean state
  process.exit(1);
});

// Load environment variables
config({ path: join(__dirname, '..', '.env.local') });
config({ path: join(__dirname, '..', '.env') });

// Check if worker is enabled
if (process.env.SMS_AUTO_SUSPEND_ENABLED === 'false') {
  console.log('[Suspend Worker] Disabled (SMS_AUTO_SUSPEND_ENABLED == false)');
  process.exit(0);
}

// Connect to MongoDB before starting worker
await connectDB();

// Schedule initial job if queue is empty
const delayedCount = await suspendQueue.getDelayedCount();
if (delayedCount === 0) {
  await suspendQueue.add(
    'quality-suspend',
    {
      type: 'suspend-check',
      subType: 'suspend-check',
      runId: crypto.randomUUID(),
      startedAt: Date.now(),
    },
    { delay: SUSPEND_CHECK_INTERVAL }
  );
  console.log('[Suspend] Initial job scheduled');
}

const worker = new Worker('quality-suspend', async (job) => {
  return withJobLogging(job, async () => {
    const result = await handleSuspendJob(job.data);

    // Schedule next run based on type (alternate between suspend and recovery)
    // Continue regardless of success/failure to prevent worker from stopping
    const currentType = job.data.type || 'suspend-check';
    const nextType = currentType === 'suspend-check' ? 'recovery-check' : 'suspend-check';
    const nextInterval = nextType === 'suspend-check' ? SUSPEND_CHECK_INTERVAL : SUSPEND_RECOVER_INTERVAL;

    // Use longer delay on failure to prevent rapid retry loops
    const delay = result.success ? nextInterval : ERROR_RETRY_DELAY;

    await suspendQueue.add(
      'quality-suspend',
      {
        type: nextType,
        subType: nextType,
        runId: crypto.randomUUID(),
        startedAt: Date.now(),
      },
      { delay }
    );

    return result;
  });
}, {
  connection: getRedis(),
  concurrency: getWorkerConcurrency('quality-suspend', 1),
});

worker.on('completed', (job) => {
  console.log(`[Suspend] Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`[Suspend] Job ${job?.id} failed:`, err.message);
});

worker.on('error', (error) => {
  console.error('[Suspend] Worker error:', error.message);
  // Continue processing other jobs
});

// Graceful shutdown
const shutdown = async () => {
  console.log('[Suspend] Shutting down worker...');
  await worker.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('[Suspend] Worker started');
