# BullMQ Worker Performance Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize BullMQ workers to fully utilize VPS resources (12 CPU cores, 62GB RAM) and reduce OTP delivery latency from ~5s to ~2s.

**Architecture:** Increase worker concurrency for parallel job processing, reduce fetch worker polling interval, and scale MongoDB connection pool to handle increased concurrent queries.

**Tech Stack:** BullMQ, Redis, MongoDB/Mongoose, PM2

---

## File Structure

**Files to modify:**
- `ecosystem.config.cjs` - PM2 configuration with worker environment variables
- `lib/db.js` - MongoDB connection pool settings

**No new files created.**

---

## Task 1: Record Baseline Metrics

**Files:**
- None (monitoring only)

- [ ] **Step 1: Record current queue statistics**

```bash
curl -s http://localhost:3000/api/queues/stats | tee /tmp/baseline-queues.json
```

Expected output: JSON with current queue stats (waiting, active, completed, failed)

- [ ] **Step 2: Record current MongoDB connection count**

```bash
echo "db.serverStatus().connections" | mongo --quiet "$(grep MONGODB_URI /home/deploy/apps/cattysms/.env | cut -d'=' -f2)" | tee /tmp/baseline-mongo-connections.txt
```

Expected output: Current, active, and available connection counts

- [ ] **Step 3: Record current worker status**

```bash
pm2 list | tee /tmp/baseline-pm2.txt
```

Expected output: PM2 process list with memory/CPU usage

---

## Task 2: Update PM2 Configuration with Worker Concurrency

**Files:**
- Modify: `ecosystem.config.cjs`

- [ ] **Step 1: Read current ecosystem.config.cjs**

```bash
cat /home/deploy/apps/cattysms/ecosystem.config.cjs
```

- [ ] **Step 2: Add concurrency environment variables to worker:fetch**

Find the `worker:fetch` section and add `BULLMQ_CONCURRENCY_SMS_FETCH: '5'` to env:

```javascript
{
  name: 'worker:fetch',
  script: 'workers/fetch-worker.js',
  env: {
    BULLMQ_FETCH_ENABLED: 'true',
    BULLMQ_CONCURRENCY_SMS_FETCH: '5',    // ADD THIS LINE
    BULLMQ_SMS_FETCH_INTERVAL: '2000',    // ADD THIS LINE (reduce from 5000ms)
  },
},
```

- [ ] **Step 3: Add concurrency environment variables to worker:status**

Find the `worker:status` section and add `BULLMQ_CONCURRENCY_DEVICE_STATUS: '3'` to env:

```javascript
{
  name: 'worker:status',
  script: 'workers/status-worker.js',
  env: {
    BULLMQ_STATUS_ENABLED: 'true',
    BULLMQ_CONCURRENCY_DEVICE_STATUS: '3',  // ADD THIS LINE
  },
},
```

- [ ] **Step 4: Add concurrency environment variables to worker:keepalive**

Find the `worker:keepalive` section and add `BULLMQ_CONCURRENCY_DEVICE_KEEPALIVE: '2'` to env:

```javascript
{
  name: 'worker:keepalive',
  script: 'workers/keepalive-worker.js',
  env: {
    BULLMQ_KEEPALIVE_ENABLED: 'true',
    BULLMQ_CONCURRENCY_DEVICE_KEEPALIVE: '2',  // ADD THIS LINE
  },
},
```

- [ ] **Step 5: Add concurrency environment variables to worker:suspend**

Find the `worker:suspend` section and add `BULLMQ_CONCURRENCY_QUALITY_SUSPEND: '2'` to env:

```javascript
{
  name: 'worker:suspend',
  script: 'workers/suspend-worker.js',
  env: {
    BULLMQ_SUSPEND_ENABLED: 'true',
    SMS_AUTO_SUSPEND_ENABLED: 'true',
    SMS_SUSPEND_THRESHOLD: '0',
    SMS_SUSPEND_WINDOW_HOURS: '12',
    BULLMQ_CONCURRENCY_QUALITY_SUSPEND: '2',  // ADD THIS LINE
  },
},
```

- [ ] **Step 6: Verify the updated configuration**

```bash
cat /home/deploy/apps/cattysms/ecosystem.config.cjs | grep -A2 "BULLMQ_CONCURRENCY"
```

Expected output: Should show all 4 BULLMQ_CONCURRENCY variables with correct values

- [ ] **Step 7: Commit configuration changes**

```bash
cd /home/deploy/apps/cattysms
git add ecosystem.config.cjs
git commit -m "feat: increase BullMQ worker concurrency for performance

- fetch worker: concurrency 1→5, interval 5s→2s
- status worker: concurrency 1→3
- keepalive worker: concurrency 1→2
- suspend worker: concurrency 1→2

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Update MongoDB Connection Pool Settings

**Files:**
- Modify: `lib/db.js`

- [ ] **Step 1: Read current lib/db.js**

```bash
cat /home/deploy/apps/cattysms/lib/db.js
```

- [ ] **Step 2: Update maxPoolSize from 20 to 50**

Replace line 16 in `lib/db.js`:

```javascript
// BEFORE:
maxPoolSize: 20,        // Increase from default 10 to 20

// AFTER:
maxPoolSize: 50,        // Increased for BullMQ worker concurrency
```

- [ ] **Step 3: Update minPoolSize from 5 to 10**

Replace line 17 in `lib/db.js`:

```javascript
// BEFORE:
minPoolSize: 5,         // Keep minimum connections ready

// AFTER:
minPoolSize: 10,        // Increased for BullMQ worker concurrency
```

- [ ] **Step 4: Add waitQueueTimeoutMS option**

Add after line 19 (socketTimeoutMS) in `lib/db.js`:

```javascript
socketTimeoutMS: 45000, // Socket timeout
waitQueueTimeoutMS: 5000, // Timeout if no connection available
```

- [ ] **Step 5: Update console log message**

Replace line 27 in `lib/db.js`:

```javascript
// BEFORE:
console.log("MongoDB connected with optimized pooling settings");

// AFTER:
console.log("MongoDB connected with BullMQ-optimized pooling (maxPoolSize: 50, minPoolSize: 10)");
```

- [ ] **Step 6: Verify the updated configuration**

```bash
cat /home/deploy/apps/cattysms/lib/db.js | grep -E "(maxPoolSize|minPoolSize|waitQueueTimeoutMS|console.log.*MongoDB)"
```

Expected output: Should show updated pool sizes and new waitQueueTimeoutMS

- [ ] **Step 7: Commit database changes**

```bash
cd /home/deploy/apps/cattysms
git add lib/db.js
git commit -m "feat: scale MongoDB connection pool for BullMQ concurrency

- maxPoolSize: 20→50 (handle parallel queries from concurrent workers)
- minPoolSize: 5→10 (maintain more ready connections)
- Add waitQueueTimeoutMS: 5000 (fail fast if pool exhausted)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Apply Configuration Changes

**Files:**
- None (PM2 operations)

- [ ] **Step 1: Reload all PM2 processes**

```bash
cd /home/deploy/apps/cattysms
pm2 reload ecosystem.config.cjs
```

Expected output: PM2 should reload all processes with new environment variables

- [ ] **Step 2: Verify all processes are online**

```bash
pm2 list
```

Expected output: All 6 processes should show status "online"

- [ ] **Step 3: Check worker logs for startup messages**

```bash
pm2 logs worker:fetch --lines 10 --nostream
pm2 logs worker:status --lines 10 --nostream
pm2 logs worker:keepalive --lines 10 --nostream
pm2 logs worker:suspend --lines 10 --nostream
```

Expected output: Should see worker startup messages with new concurrency settings

- [ ] **Step 4: Verify MongoDB connection pool in logs**

```bash
pm2 logs manager --lines 20 --nostream | grep -i "mongodb.*pool"
```

Expected output: Should see "MongoDB connected with BullMQ-optimized pooling (maxPoolSize: 50, minPoolSize: 10)"

---

## Task 5: Monitor and Validate

**Files:**
- None (monitoring only)

- [ ] **Step 1: Wait 30 seconds for workers to stabilize**

```bash
sleep 30
```

- [ ] **Step 2: Check queue statistics after changes**

```bash
curl -s http://localhost:3000/api/queues/stats | tee /tmp/after-queues.json
```

Expected output: JSON showing queue stats. Compare with baseline:
- `completed` counts should be increasing faster
- `active` count may be higher (parallel processing)
- `failed` should remain 0

- [ ] **Step 3: Compare with baseline**

```bash
echo "=== BASELINE ===" && cat /tmp/baseline-queues.json && echo -e "\n=== AFTER ===" && cat /tmp/after-queues.json
```

- [ ] **Step 4: Check MongoDB connection usage**

```bash
echo "db.serverStatus().connections" | mongo --quiet "$(grep MONGODB_URI /home/deploy/apps/cattysms/.env | cut -d'=' -f2)"
```

Expected output: Current connections should be higher (20-40 range), still well below maxPoolSize of 50

- [ ] **Step 5: Monitor worker resource usage for 5 minutes**

```bash
watch -n 10 "pm2 list --no-daemon | grep worker:"
```

Expected output: Workers should show increased CPU usage (5-20% vs near 0%), memory should be stable

Press Ctrl+C after 5 minutes of observation

- [ ] **Step 6: Check for any failed jobs**

```bash
curl -s http://localhost:3000/api/queues/dlq
```

Expected output: `failedJobs` should be empty or contain no new failures since baseline

- [ ] **Step 7: Verify fetch worker interval is faster**

Watch fetch worker logs for 30 seconds:

```bash
timeout 30 pm2 logs worker:fetch --lines 0 | grep -i "fetch.*job"
```

Expected output: Should see job completions approximately every 2-3 seconds (was ~5 seconds before)

---

## Task 6: Rollback Plan (If Issues Occur)

**Files:**
- Modify: `ecosystem.config.cjs`, `lib/db.js`

ONLY EXECUTE THIS TASK IF ISSUES ARE FOUND IN TASK 5

- [ ] **Step 1: Revert ecosystem.config.cjs changes**

```bash
cd /home/deploy/apps/cattysms
git reset --hard HEAD~1  # Revert the PM2 config commit
```

- [ ] **Step 2: Revert lib/db.js changes**

```bash
cd /home/deploy/apps/cattysms
git reset --hard HEAD~1  # Revert the DB config commit
```

- [ ] **Step 3: Reload PM2 with reverted configuration**

```bash
pm2 reload ecosystem.config.cjs
```

- [ ] **Step 4: Verify rollback successful**

```bash
pm2 list
curl -s http://localhost:3000/api/queues/stats
```

Expected output: All processes online, queues healthy

---

## Expected Outcomes

After successful implementation:

1. **Throughput:** 3-5x increase in jobs processed per second
2. **Latency:** OTP detection reduced from ~5s to ~2s average
3. **Resource utilization:** CPU usage increased from ~0% to ~20-40%
4. **Stability:** No increase in failed jobs or errors

## Success Criteria

- All PM2 processes show "online" status
- Queue `completed` counts increasing faster than baseline
- Queue `failed` counts remain at or near zero
- MongoDB connections < 50 (maxPoolSize)
- Worker CPU usage increased but < 50% per worker
- No error messages in worker logs
