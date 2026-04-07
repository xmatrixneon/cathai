// workers/suspend-worker.js
import { config } from 'dotenv';
import { Worker } from 'bullmq';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getRedis } from '../lib/queues/redis.js';
import { suspendQueue, SUSPEND_CHECK_INTERVAL, SUSPEND_RECOVER_INTERVAL } from '../lib/queues/quality-suspend.js';
import { handleSuspendJob } from '../jobs/handlers/suspend-handler.js';
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
if (process.env.BULLMQ_SUSPEND_ENABLED !== 'true') {
  console.log('[Suspend Worker] Disabled (BULLMQ_SUSPEND_ENABLED != true)');
  process.exit(0);
}

// Connect to MongoDB before starting worker
await mongoose.connect(MONGO_URI);
console.log('[Suspend] MongoDB connected');

const worker = new Worker('quality-suspend', async (job) => {
  return withJobLogging(job, async () => {
    const result = await handleSuspendJob(job.data);

    // Schedule next run based on type
    if (job.data.type === 'scheduled' && result.success) {
      const nextType = job.data.subType === 'recovery-check' ? 'suspend-check' : 'recovery-check';
      const nextInterval = nextType === 'suspend-check' ? SUSPEND_CHECK_INTERVAL : SUSPEND_RECOVER_INTERVAL;

      await suspendQueue.add(
        'quality-suspend',
        {
          type: nextType,
          subType: nextType,
          runId: crypto.randomUUID(),
          startedAt: Date.now(),
          ...job.data,
        },
        { delay: nextInterval }
      );
    }

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

// Graceful shutdown
const shutdown = async () => {
  console.log('[Suspend] Shutting down worker...');
  await worker.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('[Suspend] Worker started');
