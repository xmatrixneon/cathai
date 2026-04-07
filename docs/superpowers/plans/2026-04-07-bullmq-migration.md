# BullMQ Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate CattySMS from node-cron + PM2 to BullMQ for improved reliability, horizontal scaling, and finer job control.

**Architecture:** 6 dedicated BullMQ queues (sms:fetch, device:status, device:keepalive, device:wakeup, quality:suspend, maintenance:cleanup) with independent worker processes managed by PM2.

**Tech Stack:** BullMQ, ioredis, Redis (local), PM2, existing MongoDB/Mongoose models

---

## File Structure Map

**New files to create:**
- `lib/queues/redis.js` - Redis connection singleton
- `lib/queues/index.js` - Queue registry & exports
- `lib/queues/sms-fetch.js` - SMS fetch queue definition
- `lib/queues/device-status.js` - Device status queue definition
- `lib/queues/device-keepalive.js` - Keep-alive queue definition
- `lib/queues/device-wakeup.js` - Wake-up queue definition
- `lib/queues/quality-suspend.js` - Suspend queue definition
- `lib/queues/maintenance-cleanup.js` - Cleanup queue definition
- `jobs/utils/job-options.js` - Default job options (retries, backoff)
- `jobs/utils/job-logger.js` - Job logging utilities
- `jobs/handlers/fetch-handler.js` - Fetch business logic
- `jobs/handlers/status-handler.js` - Status business logic
- `jobs/handlers/keepalive-handler.js` - Keep-alive business logic
- `jobs/handlers/wakeup-handler.js` - Wake-up business logic
- `jobs/handlers/suspend-handler.js` - Suspend business logic
- `jobs/handlers/cleanup-handler.js` - Cleanup business logic
- `workers/fetch-worker.js` - Fetch worker
- `workers/status-worker.js` - Status worker
- `workers/keepalive-worker.js` - Keep-alive worker
- `workers/wakeup-worker.js` - Wake-up worker
- `workers/suspend-worker.js` - Suspend worker
- `workers/cleanup-worker.js` - Cleanup worker
- `app/api/queues/stats/route.js` - Queue stats API
- `app/api/queues/dlq/route.js` - DLQ API

**Files to modify:**
- `package.json` - Add bullmq and ioredis dependencies
- `.env` - Add Redis and BullMQ configuration
- `ecosystem.config.cjs` - Add worker processes

---

# PHASE 1: Setup & Infrastructure

## Task 1: Install BullMQ Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add BullMQ dependencies to package.json**

```bash
npm install bullmq ioredis
```

Expected output: Packages added to package.json and node_modules

- [ ] **Step 2: Verify installation**

```bash
npm ls bullmq ioredis
```

Expected output:
```
cattysms@X.X.X /home/deploy/apps/cattysms
├── bullmq@X.X.X
└── ioredis@X.X.X
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add bullmq and ioredis dependencies"
```

---

## Task 2: Create Directory Structure

**Files:**
- Create directories

- [ ] **Step 1: Create directories**

```bash
mkdir -p lib/queues jobs/utils jobs/handlers workers app/api/queues/stats app/api/queues/dlq
```

Expected output: Directories created

- [ ] **Step 2: Verify structure**

```bash
ls -la lib/queues/ jobs/utils/ jobs/handlers/ workers/
```

Expected output: Directory listings showing empty folders

- [ ] **Step 3: Create .gitkeep files**

```bash
touch lib/queues/.gitkeep jobs/utils/.gitkeep jobs/handlers/.gitkeep workers/.gitkeep
```

- [ ] **Step 4: Commit**

```bash
git add lib/ jobs/ workers/ app/api/queues/
git commit -m "feat: create directory structure for BullMQ"
```

---

## Task 3: Create Redis Connection Singleton

**Files:**
- Create: `lib/queues/redis.js`

- [ ] **Step 1: Create Redis connection module**

```javascript
// lib/queues/redis.js
import Redis from 'ioredis';

let redisInstance = null;

export function getRedis() {
  if (!redisInstance) {
    const redisUrl = process.env.REDIS_URI || 'redis://localhost:6379';
    const redisDb = parseInt(process.env.REDIS_DB || '0');
    const maxRetries = parseInt(process.env.REDIS_MAX_RETRIES_PER_REQUEST || '3');

    redisInstance = new Redis(redisUrl, {
      db: redisDb,
      maxRetriesPerRequest: maxRetries,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      enableReadyCheck: true,
    });

    redisInstance.on('error', (err) => {
      console.error('[Redis] Connection error:', err);
    });

    redisInstance.on('connect', () => {
      console.log('[Redis] Connected');
    });

    redisInstance.on('ready', () => {
      console.log('[Redis] Ready');
    });
  }

  return redisInstance;
}

export async function closeRedis() {
  if (redisInstance) {
    await redisInstance.quit();
    redisInstance = null;
  }
}

export function getRedisStatus() {
  return {
    connected: redisInstance?.status === 'ready',
    status: redisInstance?.status || 'not_initialized'
  };
}
```

- [ ] **Step 2: Test connection (create temporary test file)**

Create `test-redis-connection.mjs`:

```javascript
import { getRedis, closeRedis } from './lib/queues/redis.js';

const redis = getRedis();
console.log('Redis status:', redis.status);

redis.ping().then(() => {
  console.log('Redis PING successful!');
  closeRedis().then(() => process.exit(0));
}).catch((err) => {
  console.error('Redis PING failed:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Run test**

```bash
node test-redis-connection.mjs
```

Expected: `[Redis] Connected` and `Redis PING successful!` (or error if Redis not running)

- [ ] **Step 4: Clean up test file**

```bash
rm test-redis-connection.mjs
```

- [ ] **Step 5: Commit**

```bash
git add lib/queues/redis.js
git commit -m "feat: add Redis connection singleton"
```

---

## Task 4: Create Job Options Utility

**Files:**
- Create: `jobs/utils/job-options.js`

- [ ] **Step 1: Create job options configuration**

```javascript
// jobs/utils/job-options.js
import { getRedis } from '../../lib/queues/redis.js';

// Job options configuration for each queue type
export const jobOptions = {
  'sms:fetch': {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
  'device:status': {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: 50,
    removeOnFail: 250,
  },
  'device:keepalive': {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 3000,
    },
    removeOnComplete: 50,
    removeOnFail: 200,
  },
  'device:wakeup': {
    attempts: 1,
    backoff: {
      type: 'fixed',
      delay: 10000,
    },
    removeOnComplete: 100,
    removeOnFail: 100,
  },
  'quality:suspend': {
    attempts: 2,
    backoff: {
      type: 'fixed',
      delay: 10000,
    },
    removeOnComplete: 20,
    removeOnFail: 100,
  },
  'maintenance:cleanup': {
    attempts: 1,
    backoff: {
      type: 'fixed',
      delay: 5000,
    },
    removeOnComplete: 10,
    removeOnFail: 50,
  },
};

// Get job options for a specific queue
export function getJobOptions(queueName) {
  return jobOptions[queueName] || {};
}

// Common queue connection options
export function getQueueOptions() {
  return {
    connection: getRedis(),
  };
}

// Worker concurrency configuration from env
export function getWorkerConcurrency(queueName, defaultConcurrency = 1) {
  const envVar = `BULLMQ_CONCURRENCY_${queueName.replace(':', '_').toUpperCase()}`;
  return parseInt(process.env[envVar] || String(defaultConcurrency), 10);
}

// Job intervals from env (milliseconds)
export function getJobInterval(queueName, defaultInterval) {
  const envVar = `BULLMQ_${queueName.replace(':', '_').toUpperCase()}_INTERVAL`;
  return parseInt(process.env[envVar] || String(defaultInterval), 10);
}
```

- [ ] **Step 2: Commit**

```bash
git add jobs/utils/job-options.js
git commit -m "feat: add job options configuration utility"
```

---

## Task 5: Create Job Logging Utility

**Files:**
- Create: `jobs/utils/job-logger.js`

- [ ] **Step 1: Create job logging utility**

```javascript
// jobs/utils/job-logger.js
export async function withJobLogging(job, fn) {
  const startTime = Date.now();
  const jobId = job.id;
  const queueName = job.queueName;
  const jobType = job.data.type || 'unknown';

  console.log(`[${queueName}] Starting job ${jobId} (${jobType})`);

  try {
    const result = await fn();
    const duration = Date.now() - startTime;

    console.log(`[${queueName}] Job ${jobId} completed in ${duration}ms`, {
      processed: result.processed,
      errors: result.errors,
      success: result.success,
    });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[${queueName}] Job ${jobId} failed after ${duration}ms:`, error.message);
    throw error;
  }
}

export function logJobStart(queueName, jobId, data) {
  console.log(`[${queueName}] Job ${jobId} started`, {
    type: data.type,
    runId: data.runId,
  });
}

export function logJobComplete(queueName, jobId, result, duration) {
  console.log(`[${queueName}] Job ${jobId} completed in ${duration}ms`, {
    success: result.success,
    processed: result.processed,
    errors: result.errors,
  });
}

export function logJobError(queueName, jobId, error, duration) {
  console.error(`[${queueName}] Job ${jobId} failed after ${duration}ms:`, {
    error: error.message,
    stack: error.stack,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add jobs/utils/job-logger.js
git commit -m "feat: add job logging utility"
```

---

# PHASE 2: Queue Definitions

## Task 6: Create SMS Fetch Queue

**Files:**
- Create: `lib/queues/sms-fetch.js`

- [ ] **Step 1: Create SMS fetch queue definition**

```javascript
// lib/queues/sms-fetch.js
import { Queue } from 'bullmq';
import { getQueueOptions, getJobOptions, getJobInterval } from '../../jobs/utils/job-options.js';

export const fetchQueue = new Queue('sms:fetch', {
  ...getQueueOptions(),
  defaultJobOptions: getJobOptions('sms:fetch'),
});

// Schedule interval from env or default 5000ms
export const FETCH_INTERVAL = getJobInterval('sms:fetch', 5000);

export async function addFetchJob(options = {}) {
  const { type = 'scheduled', delay = 0 } = options;

  return await fetchQueue.add(
    'sms:fetch',
    {
      type,
      runId: crypto.randomUUID(),
      startedAt: Date.now(),
    },
    {
      delay,
    }
  );
}

export async function getFetchStats() {
  return {
    waiting: await fetchQueue.getWaitingCount(),
    active: await fetchQueue.getActiveCount(),
    completed: await fetchQueue.getCompletedCount(),
    failed: await fetchQueue.getFailedCount(),
    delayed: await fetchQueue.getDelayedCount(),
    workers: await fetchQueue.getWorkersCount(),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/queues/sms-fetch.js
git commit -m "feat: add SMS fetch queue definition"
```

---

## Task 7: Create Device Status Queue

**Files:**
- Create: `lib/queues/device-status.js`

- [ ] **Step 1: Create device status queue definition**

```javascript
// lib/queues/device-status.js
import { Queue } from 'bullmq';
import { getQueueOptions, getJobOptions, getJobInterval } from '../../jobs/utils/job-options.js';

export const statusQueue = new Queue('device:status', {
  ...getQueueOptions(),
  defaultJobOptions: getJobOptions('device:status'),
});

// Schedule interval from env or default 15000ms
export const STATUS_INTERVAL = getJobInterval('device:status', 15000);

export async function addStatusJob(options = {}) {
  const { type = 'scheduled', fullSync = false, delay = 0 } = options;

  return await statusQueue.add(
    'device:status',
    {
      type,
      runId: crypto.randomUUID(),
      fullSync,
      startedAt: Date.now(),
    },
    {
      delay,
    }
  );
}

export async function getStatusStats() {
  return {
    waiting: await statusQueue.getWaitingCount(),
    active: await statusQueue.getActiveCount(),
    completed: await statusQueue.getCompletedCount(),
    failed: await statusQueue.getFailedCount(),
    delayed: await statusQueue.getDelayedCount(),
    workers: await statusQueue.getWorkersCount(),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/queues/device-status.js
git commit -m "feat: add device status queue definition"
```

---

## Task 8: Create Device Keepalive Queue

**Files:**
- Create: `lib/queues/device-keepalive.js`

- [ ] **Step 1: Create device keepalive queue definition**

```javascript
// lib/queues/device-keepalive.js
import { Queue } from 'bullmq';
import { getQueueOptions, getJobOptions, getJobInterval } from '../../jobs/utils/job-options.js';

export const keepaliveQueue = new Queue('device:keepalive', {
  ...getQueueOptions(),
  defaultJobOptions: getJobOptions('device:keepalive'),
});

// Schedule interval from env or default 30000ms
export const KEEPALIVE_INTERVAL = getJobInterval('device:keepalive', 30000);

export async function addKeepaliveJob(options = {}) {
  const { type = 'scheduled', targetDeviceIds = null, delay = 0 } = options;

  return await keepaliveQueue.add(
    'device:keepalive',
    {
      type,
      runId: crypto.randomUUID(),
      targetDeviceIds,
      startedAt: Date.now(),
    },
    {
      delay,
    }
  );
}

export async function getKeepaliveStats() {
  return {
    waiting: await keepaliveQueue.getWaitingCount(),
    active: await keepaliveQueue.getActiveCount(),
    completed: await keepaliveQueue.getCompletedCount(),
    failed: await keepaliveQueue.getFailedCount(),
    delayed: await keepaliveQueue.getDelayedCount(),
    workers: await keepaliveQueue.getWorkersCount(),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/queues/device-keepalive.js
git commit -m "feat: add device keepalive queue definition"
```

---

## Task 9: Create Device Wakeup Queue

**Files:**
- Create: `lib/queues/device-wakeup.js`

- [ ] **Step 1: Create device wakeup queue definition**

```javascript
// lib/queues/device-wakeup.js
import { Queue } from 'bullmq';
import { getQueueOptions, getJobOptions, getJobInterval } from '../../jobs/utils/job-options.js';

export const wakeupQueue = new Queue('device:wakeup', {
  ...getQueueOptions(),
  defaultJobOptions: getJobOptions('device:wakeup'),
});

// Schedule interval from env or default 120000ms
export const WAKEUP_INTERVAL = getJobInterval('device:wakeup', 120000);

export async function addWakeupJob(options = {}) {
  const { type = 'scheduled', targetDeviceId = null, maxAttempts = 3, delay = 0 } = options;

  return await wakeupQueue.add(
    'device:wakeup',
    {
      type,
      runId: crypto.randomUUID(),
      targetDeviceId,
      maxAttempts,
      startedAt: Date.now(),
    },
    {
      delay,
    }
  );
}

export async function getWakeupStats() {
  return {
    waiting: await wakeupQueue.getWaitingCount(),
    active: await wakeupQueue.getActiveCount(),
    completed: await wakeupQueue.getCompletedCount(),
    failed: await wakeupQueue.getFailedCount(),
    delayed: await wakeupQueue.getDelayedCount(),
    workers: await wakeupQueue.getWorkersCount(),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/queues/device-wakeup.js
git commit -m "feat: add device wakeup queue definition"
```

---

## Task 10: Create Quality Suspend Queue

**Files:**
- Create: `lib/queues/quality-suspend.js`

- [ ] **Step 1: Create quality suspend queue definition**

```javascript
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
```

- [ ] **Step 2: Commit**

```bash
git add lib/queues/quality-suspend.js
git commit -m "feat: add quality suspend queue definition"
```

---

## Task 11: Create Maintenance Cleanup Queue

**Files:**
- Create: `lib/queues/maintenance-cleanup.js`

- [ ] **Step 1: Create maintenance cleanup queue definition**

```javascript
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
```

- [ ] **Step 2: Commit**

```bash
git add lib/queues/maintenance-cleanup.js
git commit -m "feat: add maintenance cleanup queue definition"
```

---

## Task 12: Create Queue Registry

**Files:**
- Create: `lib/queues/index.js`

- [ ] **Step 1: Create queue registry with all exports**

```javascript
// lib/queues/index.js
export { getRedis, closeRedis, getRedisStatus } from './redis.js';

export { fetchQueue, addFetchJob, getFetchStats, FETCH_INTERVAL } from './sms-fetch.js';
export { statusQueue, addStatusJob, getStatusStats, STATUS_INTERVAL } from './device-status.js';
export { keepaliveQueue, addKeepaliveJob, getKeepaliveStats, KEEPALIVE_INTERVAL } from './device-keepalive.js';
export { wakeupQueue, addWakeupJob, getWakeupStats, WAKEUP_INTERVAL } from './device-wakeup.js';
export { suspendQueue, addSuspendJob, getSuspendStats, SUSPEND_CHECK_INTERVAL, SUSPEND_RECOVER_INTERVAL } from './quality-suspend.js';
export { cleanupQueue, addCleanupJob, getCleanupStats, CLEANUP_INTERVAL } from './maintenance-cleanup.js';

// Get all queues as array for iteration
export function getAllQueues() {
  return [
    { name: 'sms:fetch', queue: fetchQueue, getStats: getFetchStats },
    { name: 'device:status', queue: statusQueue, getStats: getStatusStats },
    { name: 'device:keepalive', queue: keepaliveQueue, getStats: getKeepaliveStats },
    { name: 'device:wakeup', queue: wakeupQueue, getStats: getWakeupStats },
    { name: 'quality:suspend', queue: suspendQueue, getStats: getSuspendStats },
    { name: 'maintenance:cleanup', queue: cleanupQueue, getStats: getCleanupStats },
  ];
}

// Get queue by name
export function getQueueByName(queueName) {
  const queues = getAllQueues();
  return queues.find(q => q.name === queueName)?.queue;
}

// Close all queues (for graceful shutdown)
export async function closeAllQueues() {
  await Promise.all([
    fetchQueue.close(),
    statusQueue.close(),
    keepaliveQueue.close(),
    wakeupQueue.close(),
    suspendQueue.close(),
    cleanupQueue.close(),
  ]);
}
```

- [ ] **Step 2: Test exports (create temporary test file)**

Create `test-queue-exports.mjs`:

```javascript
import { getAllQueues, getQueueByName } from './lib/queues/index.js';

console.log('All queues:', getAllQueues().map(q => q.name));
console.log('Fetch queue:', getQueueByName('sms:fetch')?.name);
```

- [ ] **Step 3: Run test**

```bash
node test-queue-exports.mjs
```

Expected: Array of queue names printed

- [ ] **Step 4: Clean up test file**

```bash
rm test-queue-exports.mjs
```

- [ ] **Step 5: Commit**

```bash
git add lib/queues/index.js
git commit -m "feat: add queue registry with all exports"
```

---

# PHASE 3: Business Logic Handlers

## Task 13: Read Original Scripts for Reference

**Files:**
- Read: `script/cleanup-messages.mjs`, `script/suspend-low-sms.mjs`, `script/wakeup.mjs`, `script/keepalive.mjs`, `script/status.mjs`, `script/fetch.mjs`

- [ ] **Step 1: Read all original scripts**

```bash
# We'll read each script to understand the business logic
# These will be used to extract business logic into handlers
```

Note: The actual content of these scripts will be used in subsequent tasks. This step ensures we understand the existing implementation before refactoring.

- [ ] **Step 2: (No commit - just read operation)**

---

## Task 14: Create Cleanup Handler (Low Risk - First)

**Files:**
- Create: `jobs/handlers/cleanup-handler.js`

- [ ] **Step 1: Read original cleanup script**

```bash
cat script/cleanup-messages.mjs
```

- [ ] **Step 2: Create cleanup handler (extract business logic)**

```javascript
// jobs/handlers/cleanup-handler.js
import Message from '../../models/Message.js';

export async function handleCleanupJob(data) {
  const startTime = Date.now();
  let processed = 0;
  let errors = 0;

  try {
    const { retentionHours = 12, batchSize = 1000, dryRun = false } = data;
    const cutoffDate = new Date(Date.now() - retentionHours * 60 * 60 * 1000);

    console.log(`[Cleanup] Deleting messages older than ${cutoffDate.toISOString()} (dryRun=${dryRun})`);

    let hasMore = true;
    let totalDeleted = 0;

    while (hasMore) {
      const oldMessages = await Message.find({
        time: { $lt: cutoffDate }
      }).limit(batchSize);

      if (oldMessages.length === 0) {
        hasMore = false;
        break;
      }

      if (dryRun) {
        console.log(`[Cleanup] Would delete ${oldMessages.length} messages`);
        totalDeleted += oldMessages.length;
        processed = oldMessages.length;
        hasMore = false;
      } else {
        const idsToDelete = oldMessages.map(m => m._id);
        const deleteResult = await Message.deleteMany({ _id: { $in: idsToDelete } });
        totalDeleted += deleteResult.deletedCount;
        processed += deleteResult.deletedCount;
        console.log(`[Cleanup] Deleted ${deleteResult.deletedCount} messages`);
      }
    }

    return {
      success: true,
      processed: totalDeleted,
      errors: 0,
      duration: Date.now() - startTime,
      details: {
        retentionHours,
        cutoffDate: cutoffDate.toISOString(),
        totalDeleted,
        dryRun,
      },
    };
  } catch (error) {
    errors++;
    return {
      success: false,
      processed,
      errors,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add jobs/handlers/cleanup-handler.js
git commit -m "feat: add cleanup handler with message deletion logic"
```

---

## Task 15: Create Suspend Handler (Low Risk)

**Files:**
- Create: `jobs/handlers/suspend-handler.js`

- [ ] **Step 1: Read original suspend script**

```bash
cat script/suspend-low-sms.mjs
```

- [ ] **Step 2: Create suspend handler (extract business logic)**

```javascript
// jobs/handlers/suspend-handler.js
import Numbers from '../../models/Numbers.js';
import Orders from '../../models/Orders.js';

export async function handleSuspendJob(data) {
  const startTime = Date.now();
  let processed = 0;
  let errors = 0;
  let suspended = 0;
  let recovered = 0;

  try {
    const { type = 'suspend-check', threshold = 0, windowHours = 12, testNumber = null, dryRun = false } = data;

    const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000);

    if (type === 'suspend-check') {
      // Suspend check
      console.log(`[Suspend] Running suspend check (threshold=${threshold}, window=${windowHours}h, dryRun=${dryRun})`);

      const query = {
        suspended: { $ne: true },
        active: true,
      };

      if (testNumber) {
        query.number = testNumber;
      }

      const numbers = await Numbers.find(query);

      for (const number of numbers) {
        processed++;

        const orderCount = await Orders.countDocuments({
          number: number.number,
          createdAt: { $gte: windowStart },
        });

        if (orderCount >= threshold && threshold > 0) {
          const smsCount = await Orders.countDocuments({
            number: number.number,
            createdAt: { $gte: windowStart },
            'message.0': { $exists: true },
          });

          if (smsCount === 0) {
            if (!dryRun) {
              await Numbers.updateOne(
                { _id: number._id },
                {
                  $set: {
                    suspended: true,
                    suspensionReason: 'low_sms',
                    suspendedAt: new Date(),
                    lowSmsSuspensionCount: (number.lowSmsSuspensionCount || 0) + 1,
                    lastLowSmsCheck: new Date(),
                    smsReceivedInWindow: smsCount,
                  },
                }
              );
            }
            suspended++;
            console.log(`[Suspend] Suspended ${number.number} (${orderCount} orders, ${smsCount} SMS)`);
          } else {
            await Numbers.updateOne(
              { _id: number._id },
              { $set: { lastLowSmsCheck: new Date(), smsReceivedInWindow: smsCount } }
            );
          }
        }
      }
    } else if (type === 'recovery-check') {
      // Recovery check
      console.log(`[Suspend] Running recovery check (dryRun=${dryRun})`);

      const query = {
        suspended: true,
        suspensionReason: 'low_sms',
        active: true,
      };

      if (testNumber) {
        query.number = testNumber;
      }

      const suspendedNumbers = await Numbers.find(query);

      for (const number of suspendedNumbers) {
        processed++;

        const smsCount = await Orders.countDocuments({
          number: number.number,
          createdAt: { $gte: windowStart },
          'message.0': { $exists: true },
        });

        if (smsCount > 0) {
          if (!dryRun) {
            await Numbers.updateOne(
              { _id: number._id },
              {
                $set: {
                  suspended: false,
                  suspensionReason: 'none',
                  lowSmsSuspensionCount: 0,
                },
                $unset: { suspendedAt: '' },
              }
            );
          }
          recovered++;
          console.log(`[Suspend] Recovered ${number.number} (${smsCount} SMS received)`);
        }
      }
    }

    return {
      success: true,
      processed,
      errors,
      duration: Date.now() - startTime,
      details: {
        type,
        threshold,
        windowHours,
        suspended,
        recovered,
        dryRun,
      },
    };
  } catch (error) {
    errors++;
    return {
      success: false,
      processed,
      errors,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add jobs/handlers/suspend-handler.js
git commit -m "feat: add suspend handler with auto-suspend/recovery logic"
```

---

## Task 16: Create Wakeup Handler (Low Risk)

**Files:**
- Create: `jobs/handlers/wakeup-handler.js`

- [ ] **Step 1: Read original wakeup script**

```bash
cat script/wakeup.mjs
```

- [ ] **Step 2: Create wakeup handler (extract business logic)**

```javascript
// jobs/handlers/wakeup-handler.js
import Device from '../../models/Device.js';
import admin from 'firebase-admin';

// Initialize Firebase if not already done
let firebaseInitialized = false;
function ensureFirebaseInitialized() {
  if (!firebaseInitialized && process.env.FCM_SERVICE_ACCOUNT_KEY) {
    const serviceAccount = JSON.parse(
      require('fs').readFileSync(process.env.FCM_SERVICE_ACCOUNT_KEY, 'utf8')
    );
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    firebaseInitialized = true;
  }
}

export async function handleWakeupJob(data) {
  const startTime = Date.now();
  let processed = 0;
  let errors = 0;
  let notificationsSent = 0;

  try {
    const { type = 'scheduled', targetDeviceId = null, maxAttempts = 3 } = data;
    const offlineThreshold = parseInt(process.env.FCM_WAKE_UP_OFFLINE_THRESHOLD || '120', 10) * 1000;
    const cooldownMinutes = parseInt(process.env.FCM_WAKE_UP_COOLDOWN || '5', 10);
    const cooldownMs = cooldownMinutes * 60 * 1000;

    ensureFirebaseInitialized();

    const now = Date.now();
    const cutoffTime = new Date(now - offlineThreshold);
    const cooldownCutoff = new Date(now - cooldownMs);

    console.log(`[Wakeup] Looking for devices offline since ${cutoffTime.toISOString()}`);

    let query = {
      lastHeartbeat: { $lt: cutoffTime },
      'fcmToken.0': { $exists: true },
    };

    if (targetDeviceId) {
      query.deviceId = targetDeviceId;
    }

    const offlineDevices = await Device.find(query).limit(maxAttempts);

    // Filter out devices recently attempted
    const devicesToWake = offlineDevices.filter(device => {
      if (!device.lastWakeupAttempt) return true;
      return device.lastWakeupAttempt < cooldownCutoff;
    });

    for (const device of devicesToWake) {
      processed++;

      try {
        const message = {
          token: device.fcmToken,
          notification: {
            title: 'Wake Up',
            body: 'SMS Gateway needs your attention',
          },
          android: {
            priority: 'high',
          },
          apns: {
            payload: {
              aps: {
                contentAvailable: true,
                priority: 10,
              },
            },
          },
        };

        await admin.messaging().send(message);
        notificationsSent++;

        await Device.updateOne(
          { _id: device._id },
          { $set: { lastWakeupAttempt: new Date() } }
        );

        console.log(`[Wakeup] Sent notification to device ${device.deviceId}`);
      } catch (err) {
        errors++;
        console.error(`[Wakeup] Failed to send to ${device.deviceId}:`, err.message);
      }
    }

    return {
      success: true,
      processed,
      errors,
      duration: Date.now() - startTime,
      details: {
        offlineDevicesFound: offlineDevices.length,
        notificationsSent,
        cooldownMinutes,
      },
    };
  } catch (error) {
    return {
      success: false,
      processed,
      errors: errors + 1,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add jobs/handlers/wakeup-handler.js
git commit -m "feat: add wakeup handler with FCM notification logic"
```

---

# PHASE 4: Worker Implementation (Low-Risk Jobs First)

## Task 17: Create Cleanup Worker

**Files:**
- Create: `workers/cleanup-worker.js`

- [ ] **Step 1: Create cleanup worker**

```javascript
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
```

- [ ] **Step 2: Test worker starts without errors**

```bash
node workers/cleanup-worker.js &
sleep 2
pkill -f cleanup-worker
```

Expected: `[Cleanup] Worker started` message, then clean shutdown

- [ ] **Step 3: Commit**

```bash
git add workers/cleanup-worker.js
git commit -m "feat: add cleanup worker"
```

---

## Task 18: Create Suspend Worker

**Files:**
- Create: `workers/suspend-worker.js`

- [ ] **Step 1: Create suspend worker**

```javascript
// workers/suspend-worker.js
import { Worker } from 'bullmq';
import { getRedis } from '../lib/queues/redis.js';
import { suspendQueue, SUSPEND_CHECK_INTERVAL, SUSPEND_RECOVER_INTERVAL } from '../lib/queues/quality-suspend.js';
import { handleSuspendJob } from '../jobs/handlers/suspend-handler.js';
import { withJobLogging } from '../jobs/utils/job-logger.js';
import { getWorkerConcurrency } from '../jobs/utils/job-options.js';

// Check if worker is enabled
if (process.env.BULLMQ_SUSPEND_ENABLED !== 'true') {
  console.log('[Suspend Worker] Disabled (BULLMQ_SUSPEND_ENABLED != true)');
  process.exit(0);
}

const worker = new Worker('quality:suspend', async (job) => {
  return withJobLogging(job, async () => {
    const result = await handleSuspendJob(job.data);

    // Schedule next run based on type
    if (job.data.type === 'scheduled' && result.success) {
      const nextType = job.data.subType === 'recovery-check' ? 'suspend-check' : 'recovery-check';
      const nextInterval = nextType === 'suspend-check' ? SUSPEND_CHECK_INTERVAL : SUSPEND_RECOVER_INTERVAL;

      await suspendQueue.add(
        'quality:suspend',
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
  concurrency: getWorkerConcurrency('quality:suspend', 1),
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
```

- [ ] **Step 2: Commit**

```bash
git add workers/suspend-worker.js
git commit -m "feat: add suspend worker"
```

---

## Task 19: Create Wakeup Worker

**Files:**
- Create: `workers/wakeup-worker.js`

- [ ] **Step 1: Create wakeup worker**

```javascript
// workers/wakeup-worker.js
import { Worker } from 'bullmq';
import { getRedis } from '../lib/queues/redis.js';
import { wakeupQueue, WAKEUP_INTERVAL } from '../lib/queues/device-wakeup.js';
import { handleWakeupJob } from '../jobs/handlers/wakeup-handler.js';
import { withJobLogging } from '../jobs/utils/job-logger.js';
import { getWorkerConcurrency } from '../jobs/utils/job-options.js';

// Check if worker is enabled
if (process.env.BULLMQ_WAKEUP_ENABLED !== 'true') {
  console.log('[Wakeup Worker] Disabled (BULLMQ_WAKEUP_ENABLED != true)');
  process.exit(0);
}

const worker = new Worker('device:wakeup', async (job) => {
  return withJobLogging(job, async () => {
    const result = await handleWakeupJob(job.data);

    // Schedule next run if this was a scheduled job and successful
    if (job.data.type === 'scheduled' && result.success) {
      await wakeupQueue.add(
        'device:wakeup',
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
  concurrency: getWorkerConcurrency('device:wakeup', 2),
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
```

- [ ] **Step 2: Commit**

```bash
git add workers/wakeup-worker.js
git commit -m "feat: add wakeup worker"
```

---

# PHASE 5: Environment Configuration

## Task 20: Update .env File

**Files:**
- Modify: `.env`

- [ ] **Step 1: Add BullMQ environment variables to .env**

```bash
# Append to .env file
cat >> .env << 'EOF'

# ==========================================
# BullMQ Configuration
# ==========================================

# Redis Configuration (Required)
REDIS_URI=redis://localhost:6379
REDIS_DB=0
REDIS_MAX_RETRIES_PER_REQUEST=3

# BullMQ Configuration
BULLMQ_CONCURRENCY_FETCH=1
BULLMQ_CONCURRENCY_STATUS=1
BULLMQ_CONCURRENCY_KEEPALIVE=1
BULLMQ_CONCURRENCY_WAKEUP=2
BULLMQ_CONCURRENCY_SUSPEND=1
BULLMQ_CONCURRENCY_CLEANUP=1

# Job Scheduling (Enable/Disable individual jobs)
BULLMQ_JOBS_ENABLED=true
BULLMQ_FETCH_ENABLED=false
BULLMQ_STATUS_ENABLED=false
BULLMQ_KEEPALIVE_ENABLED=false
BULLMQ_WAKEUP_ENABLED=false
BULLMQ_SUSPEND_ENABLED=false
BULLMQ_CLEANUP_ENABLED=false

# Job Intervals (milliseconds)
BULLMQ_FETCH_INTERVAL=5000
BULLMQ_STATUS_INTERVAL=15000
BULLMQ_KEEPALIVE_INTERVAL=30000
BULLMQ_WAKEUP_INTERVAL=120000
BULLMQ_SUSPEND_CHECK_INTERVAL=900000
BULLMQ_SUSPEND_RECOVER_INTERVAL=300000
BULLMQ_CLEANUP_INTERVAL=21600000

# Job Retention
BULLMQ_REMOVE_ON_COMPLETE_AGE=86400
BULLMQ_REMOVE_ON_FAIL_AGE=604800
EOF
```

- [ ] **Step 2: Verify .env changes**

```bash
tail -30 .env
```

Expected: BullMQ configuration variables shown

- [ ] **Step 3: Commit**

```bash
git add .env
git commit -m "feat: add BullMQ environment configuration"
```

---

## Task 21: Update PM2 Configuration

**Files:**
- Modify: `ecosystem.config.cjs`

- [ ] **Step 1: Read current PM2 config**

```bash
cat ecosystem.config.cjs
```

- [ ] **Step 2: Update ecosystem.config.cjs with BullMQ workers**

```javascript
// ecosystem.config.cjs
module.exports = {
  apps: [
    // ==========================================
    // Main Application
    // ==========================================
    {
      name: 'manager',
      script: 'npm',
      args: 'start'
    },

    // ==========================================
    // BullMQ Workers (Phase 1: Low-Risk Jobs)
    // ==========================================
    {
      name: 'worker:cleanup',
      script: 'workers/cleanup-worker.js',
      autostart: false,  // Start disabled for testing
      env: {
        BULLMQ_CLEANUP_ENABLED: 'true',
      },
    },
    {
      name: 'worker:suspend',
      script: 'workers/suspend-worker.js',
      autostart: false,  // Start disabled for testing
      env: {
        BULLMQ_SUSPEND_ENABLED: 'true',
        SMS_AUTO_SUSPEND_ENABLED: 'true',
        SMS_SUSPEND_THRESHOLD: '0',
        SMS_SUSPEND_WINDOW_HOURS: '12',
      },
    },
    {
      name: 'worker:wakeup',
      script: 'workers/wakeup-worker.js',
      autostart: false,  // Start disabled for testing
      env: {
        BULLMQ_WAKEUP_ENABLED: 'true',
        FCM_WAKE_UP_OFFLINE_THRESHOLD: '120',
        FCM_WAKE_UP_COOLDOWN: '5',
      },
    },

    // ==========================================
    // Legacy Cron Scripts (Keep for rollback)
    // ==========================================
    {
      name: 'manager:numberstatus',
      script: 'script/status.mjs'
    },
    {
      name: 'manager:fetchsms',
      script: 'script/fetch.mjs'
    },
    {
      name: 'manager:suspendlowsms',
      script: 'script/suspend-low-sms.mjs',
      env: {
        SMS_AUTO_SUSPEND_ENABLED: 'true',
        SMS_SUSPEND_THRESHOLD: '0',
        SMS_SUSPEND_WINDOW_HOURS: '12'
      }
    },
    {
      name: 'manager:cleanup-messages',
      script: 'script/cleanup-messages.mjs',
      env: {
        MESSAGE_CLEANUP_ENABLED: 'true',
        MESSAGE_RETENTION_HOURS: '12',
        MESSAGE_CLEANUP_DRY_RUN: 'false',
        MESSAGE_CLEANUP_BATCH_SIZE: '1000'
      }
    },
    {
      name: 'manager:keepalive',
      script: 'script/keepalive.mjs',
      env: {
        FCM_KEEP_ALIVE_CRON: '*/30 * * * * *',
        FCM_KEEP_ALIVE_COOLDOWN: '3',
        FCM_KEEP_ALIVE_MIN_HEARTBEAT_AGE: '45'
      }
    },
  ],
};
```

- [ ] **Step 3: Verify PM2 config syntax**

```bash
node -e "console.log(require('./ecosystem.config.cjs').apps.map(a => a.name).join('\n'))"
```

Expected: List of all app names including new workers

- [ ] **Step 4: Commit**

```bash
git add ecosystem.config.cjs
git commit -m "feat: add BullMQ workers to PM2 config (Phase 1: low-risk jobs)"
```

---

# PHASE 6: Testing Low-Risk Jobs

## Task 22: Install Redis

**Files:**
- System: Redis installation

- [ ] **Step 1: Install Redis**

```bash
sudo apt update
sudo apt install -y redis-server
```

Expected: Redis installed successfully

- [ ] **Step 2: Start Redis service**

```bash
sudo systemctl start redis-server
sudo systemctl enable redis-server
```

- [ ] **Step 3: Verify Redis is running**

```bash
redis-cli ping
```

Expected: `PONG`

- [ ] **Step 4: Check Redis status**

```bash
sudo systemctl status redis-server
```

Expected: Redis service active (running)

---

## Task 23: Test Cleanup Worker

**Files:**
- Test: Worker startup and job processing

- [ ] **Step 1: Start cleanup worker via PM2**

```bash
pm2 start ecosystem.config.cjs --only worker:cleanup
```

Expected: `worker:cleanup` started

- [ ] **Step 2: Check worker logs**

```bash
pm2 logs worker:cleanup --lines 20
```

Expected: `[Cleanup] Worker started` and `[Redis] Connected` messages

- [ ] **Step 3: Add a test cleanup job (dry run)**

Create `test-cleanup-job.mjs`:

```javascript
import { addCleanupJob } from './lib/queues/maintenance-cleanup.js';

const job = await addCleanupJob({
  type: 'scheduled',
  retentionHours: 12,
  batchSize: 100,
  dryRun: true,
});

console.log('Added cleanup job:', job.id);
process.exit(0);
```

- [ ] **Step 4: Run test job**

```bash
node test-cleanup-job.mjs
```

Expected: Job ID printed

- [ ] **Step 5: Monitor job processing**

```bash
pm2 logs worker:cleanup --lines 50
```

Expected: Job completion log with processed count

- [ ] **Step 6: Verify job was scheduled**

```bash
curl -s http://localhost:3000/api/queues/stats 2>/dev/null || echo "API not ready yet"
```

- [ ] **Step 7: Clean up test file**

```bash
rm test-cleanup-job.mjs
```

---

## Task 24: Test Suspend Worker

**Files:**
- Test: Worker startup and job processing

- [ ] **Step 1: Start suspend worker via PM2**

```bash
pm2 start ecosystem.config.cjs --only worker:suspend
```

- [ ] **Step 2: Check worker logs**

```bash
pm2 logs worker:suspend --lines 20
```

- [ ] **Step 3: Add test suspend job**

Create `test-suspend-job.mjs`:

```javascript
import { addSuspendJob } from './lib/queues/quality-suspend.js';

const job = await addSuspendJob({
  type: 'suspend-check',
  threshold: 0,
  windowHours: 12,
  dryRun: true,
});

console.log('Added suspend job:', job.id);
process.exit(0);
```

- [ ] **Step 4: Run test**

```bash
node test-suspend-job.mjs
```

- [ ] **Step 5: Monitor processing**

```bash
pm2 logs worker:suspend --lines 50
```

- [ ] **Step 6: Clean up**

```bash
rm test-suspend-job.mjs
```

---

## Task 25: Test Wakeup Worker

**Files:**
- Test: Worker startup and job processing

- [ ] **Step 1: Start wakeup worker via PM2**

```bash
pm2 start ecosystem.config.cjs --only worker:wakeup
```

- [ ] **Step 2: Check worker logs**

```bash
pm2 logs worker:wakeup --lines 20
```

- [ ] **Step 3: Add test wakeup job**

Create `test-wakeup-job.mjs`:

```javascript
import { addWakeupJob } from './lib/queues/device-wakeup.js';

const job = await addWakeupJob({
  type: 'scheduled',
  maxAttempts: 3,
});

console.log('Added wakeup job:', job.id);
process.exit(0);
```

- [ ] **Step 4: Run test**

```bash
node test-wakeup-job.mjs
```

- [ ] **Step 5: Monitor processing**

```bash
pm2 logs worker:wakeup --lines 50
```

- [ ] **Step 6: Clean up**

```bash
rm test-wakeup-job.mjs
```

---

# PHASE 7: Queue Stats API

## Task 26: Create Queue Stats API

**Files:**
- Create: `app/api/queues/stats/route.js`

- [ ] **Step 1: Create queue stats API endpoint**

```javascript
// app/api/queues/stats/route.js
import { getAllQueues, getRedisStatus } from '../../../../lib/queues/index.js';

export async function GET() {
  try {
    const queues = getAllQueues();
    const queueStats = [];

    for (const { name, getStats } of queues) {
      const stats = await getStats();
      queueStats.push({
        name,
        ...stats,
      });
    }

    return Response.json({
      queues: queueStats,
      redis: getRedisStatus(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Test API endpoint**

```bash
curl http://localhost:3000/api/queues/stats
```

Expected: JSON with queue statistics

- [ ] **Step 3: Commit**

```bash
git add app/api/queues/stats/route.js
git commit -m "feat: add queue stats API endpoint"
```

---

## Task 27: Create DLQ API

**Files:**
- Create: `app/api/queues/dlq/route.js`

- [ ] **Step 1: Create DLQ API endpoint**

```javascript
// app/api/queues/dlq/route.js
import { getAllQueues, getQueueByName } from '../../../../lib/queues/index.js';

export async function GET() {
  try {
    const queues = getAllQueues();
    const failedJobs = {};

    for (const { name, queue } of queues) {
      const failed = await queue.getFailed(0, 10);
      if (failed.length > 0) {
        failedJobs[name] = failed.map(job => ({
          id: job.id,
          data: job.data,
          failedReason: job.failedReason,
          attemptsMade: job.attemptsMade,
          processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : null,
          failedAt: job.failedAt ? new Date(job.failedAt).toISOString() : null,
        }));
      }
    }

    return Response.json({
      failedJobs,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

export async function POST(req) {
  try {
    const { queue, jobId, action = 'retry' } = await req.json();

    if (!queue || !jobId) {
      return Response.json(
        { error: 'queue and jobId are required' },
        { status: 400 }
      );
    }

    const targetQueue = getQueueByName(queue);
    if (!targetQueue) {
      return Response.json(
        { error: `Queue ${queue} not found` },
        { status: 404 }
      );
    }

    const job = await targetQueue.getJob(jobId);
    if (!job) {
      return Response.json(
        { error: `Job ${jobId} not found` },
        { status: 404 }
      );
    }

    if (action === 'retry') {
      await job.retry();
    } else if (action === 'discard') {
      await job.remove();
    } else {
      return Response.json(
        { error: `Unknown action: ${action}` },
        { status: 400 }
      );
    }

    return Response.json({
      success: true,
      action,
      queue,
      jobId,
    });
  } catch (error) {
    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Test GET endpoint**

```bash
curl http://localhost:3000/api/queues/dlq
```

Expected: JSON with failed jobs (empty if none)

- [ ] **Step 3: Commit**

```bash
git add app/api/queues/dlq/route.js
git commit -m "feat: add DLQ API endpoint for failed job management"
```

---

# End of Phase 1-7 (Low-Risk Jobs)

At this point, the low-risk jobs (cleanup, suspend, wakeup) are fully implemented and tested. The next phases would cover the critical jobs (fetch, status, keepalive) following the same pattern.

---

## Phase Completion Checklist

- [ ] Phase 1: Infrastructure setup complete (Redis, BullMQ, directories)
- [ ] Phase 2: All queue definitions created
- [ ] Phase 3: Low-risk handlers implemented
- [ ] Phase 4: Low-risk workers implemented
- [ ] Phase 5: Environment configured
- [ ] Phase 6: Low-risk jobs tested
- [ ] Phase 7: Monitoring APIs created

## Next Phases (Not in this plan - would be separate):

- Phase 8: Keepalive handler and worker
- Phase 9: Status handler and worker
- Phase 10: Fetch handler and worker (most critical)
- Phase 11: Parallel run validation
- Phase 12: Cutover and cleanup
