// workers/wakeup-worker.js
import { config } from 'dotenv';
import { Worker } from 'bullmq';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getRedis } from '../lib/queues/redis.js';
import { wakeupQueue, WAKEUP_INTERVAL } from '../lib/queues/device-wakeup.js';
import { handleWakeupJob } from '../jobs/handlers/wakeup-handler.js';
import { withJobLogging } from '../jobs/utils/job-logger.js';
import { getWorkerConcurrency } from '../jobs/utils/job-options.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
config({ path: join(__dirname, '..', '.env.local') });
config({ path: join(__dirname, '..', '.env') });

// MongoDB connection
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

// Check if worker is enabled
if (process.env.BULLMQ_WAKEUP_ENABLED !== 'true') {
  console.log('[Wakeup Worker] Disabled (BULLMQ_WAKEUP_ENABLED != true)');
  process.exit(0);
}

// Connect to MongoDB before starting worker
await mongoose.connect(MONGO_URI);
console.log('[Wakeup] MongoDB connected');

const worker = new Worker('device-wakeup', async (job) => {
  return withJobLogging(job, async () => {
    const result = await handleWakeupJob(job.data);

    // Schedule next run if this was a scheduled job and successful
    if (job.data.type === 'scheduled' && result.success) {
      await wakeupQueue.add(
        'device-wakeup',
        {
          type: 'scheduled',
          runId: crypto.randomUUID(),
          startedAt: Date.now(),
          maxAttempts: job.data.maxAttempts || 3,
        },
        { delay: WAKEUP_INTERVAL }
      );
    }

    return result;
  });
}, {
  connection: getRedis(),
  concurrency: getWorkerConcurrency('device-wakeup', 2),
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
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('[Wakeup] Worker started');
