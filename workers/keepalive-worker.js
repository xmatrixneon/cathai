// workers/keepalive-worker.js
import { config } from 'dotenv';
import { Worker } from 'bullmq';
import mongoose from 'mongoose';
import connectDB from '../lib/db.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getRedis } from '../lib/queues/redis.js';
import { keepaliveQueue, KEEPALIVE_INTERVAL } from '../lib/queues/device-keepalive.js';
import { handleKeepaliveJob } from '../jobs/handlers/keepalive-handler.js';
import { withJobLogging } from '../jobs/utils/job-logger.js';
import { getWorkerConcurrency } from '../jobs/utils/job-options.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
config({ path: join(__dirname, '..', '.env.local') });
config({ path: join(__dirname, '..', '.env') });

// Check if worker is enabled
if (process.env.BULLMQ_KEEPALIVE_ENABLED !== 'true') {
  console.log('[Keepalive Worker] Disabled (BULLMQ_KEEPALIVE_ENABLED != true)');
  process.exit(0);
}

// Connect to MongoDB before starting worker
await connectDB();

// Schedule initial job if queue is empty
const delayedCount = await keepaliveQueue.getDelayedCount();
if (delayedCount === 0) {
  await keepaliveQueue.add(
    'device-keepalive',
    {
      type: 'scheduled',
      runId: crypto.randomUUID(),
      startedAt: Date.now(),
    },
    { delay: KEEPALIVE_INTERVAL }
  );
  console.log('[Keepalive] Initial job scheduled');
}

const worker = new Worker('device-keepalive', async (job) => {
  return withJobLogging(job, async () => {
    const result = await handleKeepaliveJob(job.data);

    // Schedule next run if this was a scheduled job and successful
    if (job.data.type === 'scheduled' && result.success) {
      await keepaliveQueue.add(
        'device-keepalive',
        {
          type: 'scheduled',
          runId: crypto.randomUUID(),
          startedAt: Date.now(),
        },
        { delay: KEEPALIVE_INTERVAL }
      );
    }

    return result;
  });
}, {
  connection: getRedis(),
  concurrency: getWorkerConcurrency('device-keepalive', 1),
});

worker.on('completed', (job) => {
  console.log(`[Keepalive] Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`[Keepalive] Job ${job?.id} failed:`, err.message);
});

// Graceful shutdown
const shutdown = async () => {
  console.log('[Keepalive] Shutting down worker...');
  await worker.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('[Keepalive] Worker started');
