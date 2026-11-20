// workers/watchdog-worker.js
// Queue-chain watchdog: keeps every BullMQ worker chain alive permanently.
//
// Two failure modes it covers (both observed 2026-08-29):
//   1. DEAD CHAIN — old workers reschedule only on success, so a failed or
//      stalled job leaves the queue empty forever (status chain died this
//      way). Fix: when delayed+waiting+active == 0 and workers are
//      connected, seed one scheduled job.
//   2. HUNG JOB — a hung await keeps renewing the BullMQ lock, so the job
//      is never detected as stalled and blocks the single chain forever.
//      Fix: when an active job runs longer than its queue's threshold,
//      restart the worker's PM2 app (killing the hung await). BullMQ stall
//      recovery then re-delivers the job; if it exceeds maxStalledCount it
//      lands in failed and the next watchdog pass seeds a fresh chain.
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn } from 'child_process';
import { accessSync, constants } from 'fs';
import { getRedis } from '../lib/queues/redis.js';
import { statusQueue, addStatusJob } from '../lib/queues/device-status.js';
import { fetchQueue, addFetchJob } from '../lib/queues/sms-fetch.js';
import { keepaliveQueue, addKeepaliveJob } from '../lib/queues/device-keepalive.js';
import { cleanupQueue, addCleanupJob } from '../lib/queues/maintenance-cleanup.js';
import { wakeupQueue, addWakeupJob } from '../lib/queues/device-wakeup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '..', '.env.local') });
config({ path: join(__dirname, '..', '.env') });

if (process.env.WATCHDOG_ENABLED === 'false') {
  console.log('[Watchdog Worker] Disabled (WATCHDOG_ENABLED == false)');
  process.exit(0);
}

const INTERVAL_MS = parseInt(process.env.WATCHDOG_INTERVAL_SECONDS || '60', 10) * 1000;
const DRY_RUN = process.env.WATCHDOG_DRY_RUN === 'true';
const RESTART_COOLDOWN_S = parseInt(process.env.WATCHDOG_RESTART_COOLDOWN_SECONDS || '600', 10);

// Per-queue hung-job thresholds: generous multiples of the longest healthy
// run (status sync ~60s, fetch ~5s, keepalive cycle ~60s, cleanup batches
// minutes, wakeup has its own 10-min timeout so this is a backstop).
const QUEUES = [
  { name: 'device-status', queue: statusQueue, seed: () => addStatusJob({ type: 'scheduled' }), app: 'worker:status', hungMs: 5 * 60 * 1000 },
  { name: 'sms:fetch', queue: fetchQueue, seed: () => addFetchJob({ type: 'scheduled' }), app: 'worker:fetch', hungMs: 5 * 60 * 1000 },
  { name: 'device-keepalive', queue: keepaliveQueue, seed: () => addKeepaliveJob({ type: 'scheduled' }), app: 'worker:keepalive', hungMs: 10 * 60 * 1000 },
  { name: 'maintenance:cleanup', queue: cleanupQueue, seed: () => addCleanupJob({ type: 'scheduled' }), app: 'worker:cleanup', hungMs: 15 * 60 * 1000 },
  { name: 'device-wakeup', queue: wakeupQueue, seed: () => addWakeupJob({ type: 'scheduled' }), app: 'worker:wakeup', hungMs: 12 * 60 * 1000 },
];

const redis = getRedis();

// PM2 binary resolution: this box runs PM2 from nvm as the deploy user, and
// daemon children don't reliably inherit the nvm PATH. Fall back to the bin
// dir next to the running node binary (pm2 always lives beside node there).
let pm2Bin = 'pm2';
try {
  const candidate = join(dirname(process.execPath), 'pm2');
  accessSync(candidate, constants.X_OK);
  pm2Bin = candidate;
} catch {
  // keep bare 'pm2' and rely on PATH
}

async function restartApp(app) {
  const key = `watchdog:lastRestart:${app}`;
  const last = await redis.get(key);
  if (last && Date.now() - Number(last) < RESTART_COOLDOWN_S * 1000) {
    console.log(`[Watchdog] Restart of ${app} skipped (cooldown, last ${Math.round((Date.now() - Number(last)) / 1000)}s ago)`);
    return false;
  }
  await redis.set(key, String(Date.now()), 'EX', RESTART_COOLDOWN_S * 2);

  if (DRY_RUN) {
    console.log(`[Watchdog] DRY RUN: would run \`pm2 restart ${app}\``);
    return true;
  }
  console.log(`[Watchdog] Restarting ${app} (hung job / missing worker)...`);
  return new Promise((resolve) => {
    const child = spawn(pm2Bin, ['restart', app], { cwd: join(__dirname, '..') });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => {
      console.log(`[Watchdog] pm2 restart ${app} exited ${code}${out ? `: ${out.trim().split('\n').pop()}` : ''}`);
      resolve(code === 0);
    });
    child.on('error', (err) => {
      console.error(`[Watchdog] pm2 restart ${app} failed to spawn:`, err.message);
      resolve(false);
    });
  });
}

async function checkQueue(entry) {
  const [waiting, active, delayed, workers] = await Promise.all([
    entry.queue.getWaitingCount(),
    entry.queue.getActiveCount(),
    entry.queue.getDelayedCount(),
    entry.queue.getWorkersCount(),
  ]);
  const state = `w${waiting}/a${active}/d${delayed} (${workers}w)`;
  console.log(`[Watchdog] ${entry.name}: ${state}`);

  // No consumer connected: the app is down (PM2 should auto-restart it, but
  // nudge it) — and never seed into a queue nobody would process.
  if (workers === 0) {
    console.warn(`[Watchdog] ${entry.name}: 0 workers connected for ${entry.app}`);
    await restartApp(entry.app);
    return;
  }

  // Dead chain: nothing pending, nothing running.
  if (waiting + active + delayed === 0) {
    if (DRY_RUN) {
      console.log(`[Watchdog] DRY RUN: would seed ${entry.name} (chain dead)`);
      return;
    }
    await entry.seed();
    console.log(`[Watchdog] SEEDED ${entry.name} (chain was dead)`);
    return;
  }

  // Hung job: active longer than the threshold.
  if (active > 0) {
    const activeJobs = await entry.queue.getActive(0, 9);
    const now = Date.now();
    for (const job of activeJobs) {
      const startedAt = Number(job.processedOn || job.timestamp);
      const runningMs = now - startedAt;
      if (runningMs > entry.hungMs) {
        console.warn(`[Watchdog] ${entry.name}: job ${job.id} running ${Math.round(runningMs / 1000)}s (threshold ${entry.hungMs / 1000}s)`);
        await restartApp(entry.app);
        return;
      }
    }
  }
}

let passRunning = false;
async function runPass() {
  if (passRunning) {
    console.log('[Watchdog] Previous pass still running, skipping tick');
    return;
  }
  passRunning = true;
  try {
    for (const entry of QUEUES) {
      try {
        await checkQueue(entry);
      } catch (err) {
        console.error(`[Watchdog] Error checking ${entry.name}:`, err.message);
      }
    }
  } finally {
    passRunning = false;
  }
}

process.on('unhandledRejection', (reason) => {
  console.error('[Watchdog] Unhandled Rejection:', reason);
});

let running = true;
const shutdown = async () => {
  if (!running) return;
  running = false;
  console.log('[Watchdog] Shutting down...');
  try { await redis.quit(); } catch {}
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`[Watchdog] Started (interval: ${INTERVAL_MS / 1000}s, restart cooldown: ${RESTART_COOLDOWN_S}s${DRY_RUN ? ', DRY RUN' : ''})`);
await runPass();
const timer = setInterval(runPass, INTERVAL_MS);
timer.unref?.();
