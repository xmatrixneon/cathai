// workers/wakeup-worker.js
import { config } from 'dotenv';
import { Worker } from 'bullmq';
import mongoose from 'mongoose';
import connectDB from '../lib/db.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getRedis } from '../lib/queues/redis.js';
import { wakeupQueue, WAKEUP_INTERVAL } from '../lib/queues/device-wakeup.js';
import { handleWakeupJob } from '../jobs/handlers/wakeup-handler.js';
import { withJobLogging } from '../jobs/utils/job-logger.js';
import { getWorkerConcurrency } from '../jobs/utils/job-options.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Delay for rescheduling after a failure (prevents rapid retry loops)
const ERROR_RETRY_DELAY = parseInt(process.env.BULLMQ_ERROR_RETRY_DELAY || '30000', 10);

// Hard cap on job execution so a hung await cannot hold the chain forever
// (a hung job keeps renewing the BullMQ lock and is never detected as
// stalled). Generous default: a full capped cycle plus the initial query
// stays well under it.
const JOB_TIMEOUT_MS = parseInt(process.env.BULLMQ_WAKEUP_JOB_TIMEOUT_MS || '600000', 10);

// Global error handlers to prevent worker crashes
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Wakeup] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[Wakeup] Uncaught Exception:', error);
  process.exit(1);
});

// Load environment variables
config({ path: join(__dirname, '..', '.env.local') });
config({ path: join(__dirname, '..', '.env') });

// Check if worker is enabled
if (process.env.BULLMQ_WAKEUP_ENABLED !== 'true') {
  console.log('[Wakeup Worker] Disabled (BULLMQ_WAKEUP_ENABLED != true)');
  process.exit(0);
}

// Connect to MongoDB before starting worker
await connectDB();

// Schedule initial job only when the chain is fully dead. This worker used
// to reschedule only on success, so any stalled/failed job left the queue
// permanently empty. Checking all three counts (not just delayed) avoids
// seeding a SECOND parallel chain while a job is active or waiting.
const [delayedCount, waitingCount, activeCount] = await Promise.all([
  wakeupQueue.getDelayedCount(),
  wakeupQueue.getWaitingCount(),
  wakeupQueue.getActiveCount(),
]);
if (delayedCount + waitingCount + activeCount === 0) {
  await wakeupQueue.add(
    'device-wakeup',
    { type: 'scheduled', runId: crypto.randomUUID(), startedAt: Date.now() },
    { delay: 0 }
  );
  console.log('[Wakeup] Initial job scheduled (chain was dead)');
}

const worker = new Worker('device-wakeup', async (job) => {
  return withJobLogging(job, async () => {
    let timer;
    try {
      const result = await Promise.race([
        handleWakeupJob(job.data),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Job timed out after ${JOB_TIMEOUT_MS}ms`)),
            JOB_TIMEOUT_MS
          );
        }),
      ]);

      // Always reschedule scheduled jobs (success OR failure): the chain
      // must never die again.
      if (job.data.type === 'scheduled') {
        const delay = result.success ? WAKEUP_INTERVAL : ERROR_RETRY_DELAY;
        await wakeupQueue.add(
          'device-wakeup',
          { type: 'scheduled', runId: crypto.randomUUID(), startedAt: Date.now() },
          { delay }
        );
      }

      return result;
    } catch (err) {
      // Reschedule instead of rethrowing: letting BullMQ retry the same job
      // would run a second chain in parallel with the replacement scheduled
      // here.
      if (job.data.type === 'scheduled') {
        console.error(`[Wakeup] Job ${job.id} failed (${err.message}) - rescheduling in ${ERROR_RETRY_DELAY}ms`);
        await wakeupQueue.add(
          'device-wakeup',
          { type: 'scheduled', runId: crypto.randomUUID(), startedAt: Date.now() },
          { delay: ERROR_RETRY_DELAY }
        );
      } else {
        console.error(`[Wakeup] Job ${job.id} failed:`, err.message);
      }
      return { success: false, error: err.message };
    } finally {
      clearTimeout(timer);
    }
  });
}, {
  connection: getRedis(),
  // Must stay 1: a timed-out handler may still be draining in the
  // background; higher concurrency would let its replacement overlap and
  // double-ping devices.
  concurrency: getWorkerConcurrency('device-wakeup', 1),
});

worker.on('completed', (job) => {
  console.log(`[Wakeup] Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`[Wakeup] Job ${job?.id} failed:`, err.message);
});

// Graceful shutdown
const shutdown = async () => {
  console.log('[Wakeup] Shutting down worker...');
  await worker.close();
  await mongoose.connection.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`[Wakeup] Worker started (interval: ${WAKEUP_INTERVAL}ms, job timeout: ${JOB_TIMEOUT_MS}ms)`);
