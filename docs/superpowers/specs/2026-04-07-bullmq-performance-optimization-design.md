# BullMQ Worker Performance Optimization Design

**Date:** 2026-04-07
**Status:** Approved
**Author:** Claude Code

## Overview

Optimize BullMQ workers to fully utilize VPS resources (12 CPU cores, 62GB RAM) and address performance bottlenecks: OTP delivery delays, order processing backlog, and device status lag.

## Current State

**VPS Resources:**
- 12 CPU cores
- 62GB RAM (2.9GB used, 59GB available)
- 181GB disk (8.6GB used)

**Worker Configuration:**
- All workers: concurrency = 1 (sequential processing)
- CPU usage: near 0% (severely underutilized)
- Healthy queues with no failed jobs

**Identified Issues:**
- OTP delivery delays (SMS arrives but OTP not detected quickly)
- Order processing backlog during peak loads
- Device status lag (online/offline status updates delayed)

## Proposed Changes

### 1. Worker Concurrency

Increase concurrency to allow parallel job processing:

| Worker | Current | Proposed | Environment Variable |
|--------|---------|----------|---------------------|
| fetch | 1 | 5 | BULLMQ_CONCURRENCY_SMS_FETCH=5 |
| status | 1 | 3 | BULLMQ_CONCURRENCY_DEVICE_STATUS=3 |
| keepalive | 1 | 2 | BULLMQ_CONCURRENCY_DEVICE_KEEPALIVE=2 |
| suspend | 1 | 2 | BULLMQ_CONCURRENCY_QUALITY_SUSPEND=2 |
| cleanup | 1 | 1 | (unchanged) |

### 2. Interval Tuning (Fetch Worker Only)

Reduce fetch worker polling interval for faster OTP detection:

| Worker | Current | Proposed | Environment Variable |
|--------|---------|----------|---------------------|
| fetch | 5000ms | 2000ms | BULLMQ_SMS_FETCH_INTERVAL=2000 |

All other worker intervals remain unchanged.

### 3. MongoDB Connection Pooling

Configure Mongoose connection pool to handle increased concurrent queries:

```javascript
{
  maxPoolSize: 50,        // Max connections per process
  minPoolSize: 10,        // Min connections to maintain
  maxIdleTimeMS: 30000,   // Close idle connections after 30s
  waitQueueTimeoutMS: 5000 // Timeout if no connection available
}
```

## Implementation Plan

### Phase 1: Configuration Updates

1. Update `ecosystem.config.cjs` with new environment variables
2. Update MongoDB connection options in `lib/db.js`

### Phase 2: Validation

1. Record baseline metrics before applying changes
2. Apply changes and restart workers
3. Monitor for 15-30 minutes

### Phase 3: Monitoring

Monitor key metrics:
- Failed jobs (should remain near 0)
- Queue backlog (waiting/active counts)
- MongoDB connection usage
- Worker memory/CPU usage

## Rollback Plan

If issues occur:
1. Revert environment variables in `ecosystem.config.cjs`
2. Restart workers: `pm2 restart ecosystem.config.cjs`

## Expected Outcomes

- **Throughput:** 3-5x increase in jobs processed per second
- **Latency:** OTP detection reduced from ~5s to ~2s average
- **Resource utilization:** CPU usage increased from ~0% to ~20-40%
- **Stability:** No increase in failed jobs or errors

## Files to Modify

1. `ecosystem.config.cjs` - Add worker concurrency and interval env vars
2. `lib/db.js` - Update MongoDB connection pool options
