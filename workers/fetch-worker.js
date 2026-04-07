// workers/fetch-worker.js
import { config } from 'dotenv';
import { Worker } from 'bullmq';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getRedis } from '../lib/queues/redis.js';
import { fetchQueue, FETCH_INTERVAL } from '../lib/queues/sms-fetch.js';
import { handleFetchJob } from '../jobs/handlers/fetch-handler.js';
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
if (process.env.BULLMQ_FETCH_ENABLED !== 'true') {
  console.log('[Fetch Worker] Disabled (BULLMQ_FETCH_ENABLED != true)');
  process.exit(0);
}

// Connect to MongoDB before starting worker
await mongoose.connect(MONGO_URI);
console.log('[Fetch] MongoDB connected');

const worker = new Worker('sms-fetch', async (job) => {
  return withJobLogging(job, async () => {
    const result = await handleFetchJob(job.data);

    // Schedule next run if this was a scheduled job and successful
    if (job.data.type === 'scheduled' && result.success) {
      await fetchQueue.add(
        'sms-fetch',
        {
          type: 'scheduled',
          runId: crypto.randomUUID(),
          startedAt: Date.now(),
        },
        { delay: FETCH_INTERVAL }
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

// Graceful shutdown
const shutdown = async () => {
  console.log('[Fetch] Shutting down worker...');
  await worker.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('[Fetch] Worker started');
