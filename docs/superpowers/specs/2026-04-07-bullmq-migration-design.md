# BullMQ Migration Design for CattySMS

## Context

This document describes migrating CattySMS from node-cron + PM2 to BullMQ for improved reliability, horizontal scaling, and finer job control.

**Current State:**
- 6 background scripts running via PM2 with node-cron
- Schedules range from 5 seconds to 6 hours
- No job persistence or retry mechanisms
- Single server deployment

**Target State:**
- BullMQ with dedicated queues per job type
- Job persistence in Redis
- Retry logic and failure handling
- Ready for horizontal scaling

## Design

### 1. Architecture Overview

The system will use **6 dedicated BullMQ queues**, each with its own worker process:

| Queue Name | Worker Script | Schedule | Purpose | Priority |
|------------|---------------|----------|---------|----------|
| `sms:fetch` | `workers/fetch-worker.mjs` | Every 5s | Process orders, extract OTPs | **High** |
| `device:status` | `workers/status-worker.mjs` | Every 15s | Device/number sync | **High** |
| `device:keepalive` | `workers/keepalive-worker.mjs` | Every 30s | FCM keep-alive pings | **High** |
| `device:wakeup` | `workers/wakeup-worker.mjs` | Every 2m | Wake offline devices | Medium |
| `quality:suspend` | `workers/suspend-worker.mjs` | 15m/5m | Suspend/recover numbers | Low |
| `maintenance:cleanup` | `workers/cleanup-worker.mjs` | Every 6h | Delete old messages | Low |

**Key Components:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Application Server                            │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌─────────────────┐  │
│  │ Next.js    │  │ API Routes │  │ WebSocket  │  │  Job Producer   │  │
│  │ App        │  │            │  │ Manager    │  │  (lib/queues/)  │  │
│  └────────────┘  └────────────┘  └────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼ (add jobs)
┌─────────────────────────────────────────────────────────────────────────┐
│                              Redis Server                               │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ sms:     │ │ device:  │ │ device:  │ │ device:  │ │ quality:     │  │
│  │ fetch    │ │ status   │ │ keepalive│ │ wakeup   │ │ suspend      │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │
│  ┌──────────────────┐                                                │  │
│  │ maintenance:     │                                                │  │
│  │ cleanup          │                                                │  │
│  └──────────────────┘                                                │  │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼ (process jobs)
┌─────────────────────────────────────────────────────────────────────────┐
│                           PM2 Workers (6)                              │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────┐│
│  │ fetch   │ │ status  │ │keepalive│ │ wakeup  │ │suspend  │ │cleanup││
│  │ worker  │ │ worker  │ │ worker  │ │ worker  │ │ worker  │ │worker ││
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └──────┘│
└─────────────────────────────────────────────────────────────────────────┘
```

**Job Flow:**
1. **Scheduled jobs** - Each worker adds its next run as a delayed job during processing
2. **On-demand jobs** - API routes can add jobs (e.g., immediate device wake-up via API)
3. **Retries** - Failed jobs auto-retry with exponential backoff
4. **Dead Letter Queue** - Exhausted jobs move to DLQ for manual inspection

### 2. Directory Structure & File Organization

```
cattysms/
├── lib/
│   └── queues/
│       ├── redis.js              # Redis connection singleton
│       ├── index.js              # Queue registry & exports
│       ├── sms-fetch.js          # SMS fetch queue definition
│       ├── device-status.js      # Device status queue definition
│       ├── device-keepalive.js   # Keep-alive queue definition
│       ├── device-wakeup.js      # Wake-up queue definition
│       ├── quality-suspend.js    # Suspend queue definition
│       └── maintenance-cleanup.js # Cleanup queue definition
│
├── workers/
│   ├── fetch-worker.js           # SMS fetch processor
│   ├── status-worker.js          # Device status processor
│   ├── keepalive-worker.js       # Keep-alive processor
│   ├── wakeup-worker.js          # Wake-up processor
│   ├── suspend-worker.js         # Suspend/recovery processor
│   └── cleanup-worker.js         # Cleanup processor
│
├── jobs/
│   ├── utils/
│   │   ├── job-options.js        # Default job options (retries, backoff)
│   │   └── job-logger.js         # Job logging utilities
│   └── handlers/                 # Business logic extracted from scripts/
│       ├── fetch-handler.js
│       ├── status-handler.js
│       ├── keepalive-handler.js
│       ├── wakeup-handler.js
│       ├── suspend-handler.js
│       └── cleanup-handler.js
│
├── script/                       # Original scripts (kept for reference/rollback)
│   ├── status.mjs                # → Refactored to jobs/handlers/status-handler.js
│   ├── fetch.mjs                 # → Refactored to jobs/handlers/fetch-handler.js
│   ├── suspend-low-sms.mjs       # → Refactored to jobs/handlers/suspend-handler.js
│   ├── cleanup-messages.mjs      # → Refactored to jobs/handlers/cleanup-handler.js
│   ├── keepalive.mjs             # → Refactored to jobs/handlers/keepalive-handler.js
│   └── wakeup.mjs                # → Refactored to jobs/handlers/wakeup-handler.js
│
├── ecosystem.config.cjs          # Updated with BullMQ workers
└── .env                          # Add REDIS_URI configuration
```

**Key Principles:**
1. **Separation of concerns** - Queue definitions, workers, and business logic are separate
2. **Reusability** - Business logic in `jobs/handlers/` can be called directly or via jobs
3. **Parallel run support** - Original scripts remain during migration
4. **Shared utilities** - Job options, logging, and helpers in `jobs/utils/`

### 3. Job Data Models

Each job type has a defined data structure:

```javascript
// sms:fetch job data
{
  type: 'scheduled',           // or 'on-demand'
  runId: string,               // Unique identifier for this run
  startedAt: timestamp
}

// device:status job data
{
  type: 'scheduled',
  runId: string,
  fullSync: boolean,           // true for full resync, false for incremental
  startedAt: timestamp
}

// device:keepalive job data
{
  type: 'scheduled',
  runId: string,
  targetDeviceIds?: string[],  // optional: specific devices only
  startedAt: timestamp
}

// device:wakeup job data
{
  type: 'scheduled',           // or 'on-demand' (from API)
  runId: string,
  targetDeviceId?: string,     // for on-demand single device
  maxAttempts: number,
  startedAt: timestamp
}

// quality:suspend job data
{
  type: 'suspend-check',       // or 'recovery-check'
  runId: string,
  threshold: number,
  windowHours: number,
  testNumber?: string,         // for testing mode
  dryRun: boolean,
  startedAt: timestamp
}

// maintenance:cleanup job data
{
  type: 'scheduled',
  runId: string,
  retentionHours: number,
  batchSize: number,
  dryRun: boolean,
  startedAt: timestamp
}
```

**Job Options Configuration:**

| Queue | Attempts | Backoff | Delay | RemoveOnComplete |
|-------|----------|---------|-------|------------------|
| sms:fetch | 3 | exponential (5s base) | 0 | 100 |
| device:status | 3 | exponential (5s base) | 0 | 50 |
| device:keepalive | 2 | exponential (3s base) | 0 | 50 |
| device:wakeup | 1 | fixed | 0 | 100 |
| quality:suspend | 2 | fixed (10s) | 0 | 20 |
| maintenance:cleanup | 1 | fixed | 0 | 10 |

**Result Objects** (returned from handlers):

```javascript
{
  success: boolean,
  processed: number,           // items processed
  errors: number,              // errors encountered
  duration: number,            // execution time in ms
  details: object,             // job-specific details
  nextRunAt?: timestamp,       // for scheduling next run
  error?: string               // error message if failed
}
```

### 4. Worker Implementation

Each worker follows a consistent pattern:

```javascript
// workers/fetch-worker.js (example structure)
import { Queue, Worker } from 'bullmq';
import { getRedis } from '../lib/queues/redis.js';
import { fetchQueue } from '../lib/queues/sms-fetch.js';
import { handleFetchJob } from '../jobs/handlers/fetch-handler.js';
import { withJobLogging } from '../jobs/utils/job-logger.js';

const worker = new Worker('sms:fetch', async (job) => {
  return withJobLogging(job, async () => {
    const result = await handleFetchJob(job.data);

    // Schedule next run if this was a scheduled job
    if (job.data.type === 'scheduled' && result.success) {
      await fetchQueue.add(
        'sms:fetch',
        { type: 'scheduled', runId: crypto.randomUUID(), startedAt: Date.now() },
        { delay: 5000 } // 5 seconds
      );
    }

    return result;
  });
}, {
  connection: getRedis(),
  concurrency: 1, // Only one fetch job at a time
});

worker.on('completed', (job) => {
  console.log(`[Fetch] Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`[Fetch] Job ${job?.id} failed:`, err);
});
```

**Handler Pattern** (jobs/handlers):

```javascript
// jobs/handlers/fetch-handler.js
// Business logic extracted from script/fetch.mjs
export async function handleFetchJob(data) {
  const startTime = Date.now();
  let processed = 0;
  let errors = 0;

  try {
    // Import and use existing models
    const activeOrders = await Orders.find({ active: true, isused: false });

    for (const order of activeOrders) {
      // ... existing OTP extraction logic ...
      processed++;
    }

    return {
      success: true,
      processed,
      errors,
      duration: Date.now() - startTime,
      details: { ordersProcessed: activeOrders.length }
    };
  } catch (error) {
    return {
      success: false,
      processed,
      errors: errors + 1,
      duration: Date.now() - startTime,
      error: error.message
    };
  }
}
```

**Graceful Shutdown:**

```javascript
// All workers include shutdown handling
const shutdown = async () => {
  console.log(`Shutting down ${worker.name}...`);
  await worker.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
```

### 5. Migration Strategy

**Phase 1: Setup & Infrastructure (Day 1)**
1. Install Redis locally on the VPS
2. Add BullMQ dependencies (`npm install bullmq ioredis`)
3. Configure Redis connection in `.env` (`REDIS_URI=redis://localhost:6379`)
4. Create directory structure (`lib/queues/`, `workers/`, `jobs/`)

**Phase 2: Low-Risk Jobs First (Days 2-3)**
Start with lowest-impact jobs to validate the pattern:

| Order | Script | Queue | Risk Level | Validation |
|--------|--------|-------|------------|------------|
| 1st | `cleanup-messages.mjs` | `maintenance:cleanup` | **Low** | Check old messages are deleted |
| 2nd | `suspend-low-sms.mjs` | `quality:suspend` | **Medium** | Verify suspend/recovery works |
| 3rd | `wakeup.mjs` | `device:wakeup` | **Low** | Test FCM wake-up notifications |

**Phase 3: Critical Jobs (Days 4-5)**
Migrate time-sensitive jobs:

| Order | Script | Queue | Risk Level | Validation |
|--------|--------|-------|------------|------------|
| 4th | `keepalive.mjs` | `device:keepalive` | **Medium** | Monitor device uptime |
| 5th | `status.mjs` | `device:status` | **High** | Verify number sync works |
| 6th | `fetch.mjs` | `sms:fetch` | **Critical** | Test OTP delivery end-to-end |

**Phase 4: Cutover (Day 6)**
1. Run both cron + BullMQ in parallel for 24 hours
2. Monitor metrics: job completion rates, errors, processing times
3. Disable cron jobs one by one after validation
4. Remove old scripts from PM2 config
5. Update documentation

**Rollback Plan:**
- Keep original scripts in place (disabled in PM2)
- Quick rollback: `pm2 restart ecosystem.config.cjs --only-cron`
- Redis jobs persist across restarts

### 6. Environment Configuration

**New Environment Variables:**

```bash
# .env additions

# Redis Configuration (Required)
REDIS_URI=redis://localhost:6379
REDIS_DB=0                    # BullMQ uses separate DB for isolation
REDIS_MAX_RETRIES_PER_REQUEST=3

# BullMQ Configuration
BULLMQ_CONCURRENCY_FETCH=1    # Process one fetch job at a time
BULLMQ_CONCURRENCY_STATUS=1   # Process one status job at a time
BULLMQ_CONCURRENCY_KEEPALIVE=1
BULLMQ_CONCURRENCY_WAKEUP=2   # Can process multiple wake-ups
BULLMQ_CONCURRENCY_SUSPEND=1
BULLMQ_CONCURRENCY_CLEANUP=1

# Job Scheduling (Enable/Disable individual jobs)
BULLMQ_JOBS_ENABLED=true      # Master switch
BULLMQ_FETCH_ENABLED=true
BULLMQ_STATUS_ENABLED=true
BULLMQ_KEEPALIVE_ENABLED=true
BULLMQ_WAKEUP_ENABLED=true
BULLMQ_SUSPEND_ENABLED=true
BULLMQ_CLEANUP_ENABLED=true

# Job Intervals (milliseconds) - for scheduling next runs
BULLMQ_FETCH_INTERVAL=5000
BULLMQ_STATUS_INTERVAL=15000
BULLMQ_KEEPALIVE_INTERVAL=30000
BULLMQ_WAKEUP_INTERVAL=120000
BULLMQ_SUSPEND_CHECK_INTERVAL=900000    # 15 minutes
BULLMQ_SUSPEND_RECOVER_INTERVAL=300000  # 5 minutes
BULLMQ_CLEANUP_INTERVAL=21600000        # 6 hours

# Job Retention (keep completed/failed jobs)
BULLMQ_REMOVE_ON_COMPLETE_AGE=86400     # 24 hours
BULLMQ_REMOVE_ON_FAIL_AGE=604800        # 7 days
```

**Updated PM2 Configuration:**

```javascript
// ecosystem.config.cjs
module.exports = {
  apps: [
    // Main application
    {
      name: 'manager',
      script: 'npm',
      args: 'start'
    },
    
    // BullMQ Workers (new)
    {
      name: 'worker:fetch',
      script: 'workers/fetch-worker.js',
      env: { BULLMQ_FETCH_ENABLED: 'true' }
    },
    {
      name: 'worker:status',
      script: 'workers/status-worker.js',
      env: { BULLMQ_STATUS_ENABLED: 'true' }
    },
    {
      name: 'worker:keepalive',
      script: 'workers/keepalive-worker.js',
      env: { BULLMQ_KEEPALIVE_ENABLED: 'true' }
    },
    {
      name: 'worker:wakeup',
      script: 'workers/wakeup-worker.js',
      env: { BULLMQ_WAKEUP_ENABLED: 'true' }
    },
    {
      name: 'worker:suspend',
      script: 'workers/suspend-worker.js',
      env: { BULLMQ_SUSPEND_ENABLED: 'true' }
    },
    {
      name: 'worker:cleanup',
      script: 'workers/cleanup-worker.js',
      env: { BULLMQ_CLEANUP_ENABLED: 'true' }
    },

    // Legacy cron scripts (disabled during migration)
    {
      name: 'legacy:cleanup-messages',
      script: 'script/cleanup-messages.mjs',
      autostart: false,  // Disabled after migration
      env: {
        MESSAGE_CLEANUP_ENABLED: 'true',
        MESSAGE_RETENTION_HOURS: '12'
      }
    },
    // ... other legacy scripts with autostart: false
  ]
};
```

### 7. Monitoring & Observability

**Queue Metrics API** (new endpoint):

```javascript
// /api/queues/stats - Get all queue statistics
export async function GET() {
  const stats = {
    queues: [
      {
        name: 'sms:fetch',
        waiting: await fetchQueue.getWaitingCount(),
        active: await fetchQueue.getActiveCount(),
        completed: await fetchQueue.getCompletedCount(),
        failed: await fetchQueue.getFailedCount(),
        delayed: await fetchQueue.getDelayedCount(),
        workers: await fetchQueue.getWorkersCount()
      },
      // ... same for other queues
    ],
    redis: {
      connected: redis.status === 'ready',
      memory: await redis.memory('usage'),
      uptime: await redis.info('uptime')
    }
  };
  return Response.json(stats);
}
```

**Job Logging Utility:**

```javascript
// jobs/utils/job-logger.js
export async function withJobLogging(job, fn) {
  const startTime = Date.now();
  const jobId = job.id;
  const queueName = job.queueName;

  console.log(`[${queueName}] Starting job ${jobId}`);
  
  try {
    const result = await fn();
    const duration = Date.now() - startTime;
    
    console.log(`[${queueName}] Job ${jobId} completed in ${duration}ms`, {
      processed: result.processed,
      errors: result.errors
    });
    
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[${queueName}] Job ${jobId} failed after ${duration}ms:`, error);
    throw error;
  }
}
```

**PM2 Monitoring:**

```bash
# View all workers
pm2 list

# Monitor specific worker logs
pm2 logs worker:fetch
pm2 logs worker:status

# Monitor resource usage
pm2 monit

# Custom metrics keymetrics (optional)
pm2 install pm2-logrotate
```

**Dead Letter Queue Monitoring:**

```javascript
// /api/queues/dlq - List failed jobs
export async function GET() {
  const failedJobs = {
    'sms:fetch': await fetchQueue.getFailed(0, 10),
    'device:status': await statusQueue.getFailed(0, 10),
    // ... other queues
  };
  return Response.json(failedJobs);
}

// POST /api/queues/dlq/retry - Retry failed job
export async function POST(req) {
  const { queue, jobId } = await req.json();
  const targetQueue = getQueueByName(queue);
  await targetQueue.getJob(jobId).then(job => job.retry());
  return Response.json({ success: true });
}
```

### 8. Testing & Validation

**Pre-Migration Checklist:**

- [ ] Redis installed and running locally
- [ ] Redis connection tested (`redis-cli ping`)
- [ ] BullMQ packages installed (`npm install bullmq ioredis`)
- [ ] Environment variables configured in `.env`
- [ ] Directory structure created
- [ ] Backup of current PM2 config taken

**Testing Protocol (per job):**

| Test Step | Command | Expected Result |
|-----------|---------|-----------------|
| 1. Start worker | `pm2 start workers/xxx-worker.js` | Worker shows "online" |
| 2. Check logs | `pm2 logs worker:xxx --lines 20` | No errors, connected to Redis |
| 3. Add test job | `node script/test-job.js xxx` | Job appears in queue |
| 4. Monitor processing | Watch logs for completion | Job completes successfully |
| 5. Verify result | Check database/system | Expected side effects occurred |
| 6. Test retry | Kill worker mid-job | Job retries on restart |
| 7. Test next run | Verify delayed job created | Next job scheduled |

**Validation Matrix:**

| Job | Database Check | System Behavior |
|-----|----------------|-----------------|
| **fetch** | Orders have `message[]` populated | OTPs delivered to clients |
| **status** | Numbers have correct `active` state | Device status accurate |
| **keepalive** | Devices have recent `lastHeartbeat` | Devices stay online |
| **wakeup** | Devices come back online | FCM notifications sent |
| **suspend** | Numbers have `suspended: true/false` | Low-SMS numbers suspended |
| **cleanup** | Old messages deleted | DB size reduced |

**Load Testing:**

```bash
# Add 100 test jobs to fetch queue
node script/load-test-fetch.js 100

# Monitor queue depth
curl http://localhost:3000/api/queues/stats

# Verify processing time < 5 seconds
```

**Production Cutover Validation:**

1. **Parallel Run (24 hours):**
   - Both cron and BullMQ running
   - Compare metrics side-by-side
   - Check for duplicate processing

2. **Data Integrity:**
   - No duplicate orders/messages
   - All devices accounted for
   - No missing number updates

3. **Performance:**
   - Job latency < cron interval
   - No Redis memory buildup
   - CPU usage within limits

4. **Final Cutover:**
   - Disable cron jobs in PM2
   - Monitor for 1 hour
   - Remove from config if stable

## Summary

**This design provides:**

- ✅ **Reliability**: Job persistence, retries, DLQ
- ✅ **Scalability**: Independent workers, can scale horizontally
- ✅ **Control**: Priorities, delays, on-demand jobs
- ✅ **Observability**: Queue stats, logging, monitoring APIs
- ✅ **Safety**: Parallel migration, easy rollback
```
