// ecosystem.config.cjs - MAXIMIZED configuration for 12-core / 62GB RAM VPS
// Fully utilize available hardware resources

const os = require('os');

// Hardware detection
const cpuCount = os.cpus().length; // 12 cores
const totalMemGB = os.totalmem() / (1024 ** 3); // ~62GB

// MAXIMIZED Scaling calculations for 12-core / 62GB system
const highConcurrencyWorkers = cpuCount * 2; // 24 concurrent jobs (was 12)
const mediumConcurrencyWorkers = cpuCount; // 12 concurrent (was 6)
const lowConcurrencyWorkers = Math.floor(cpuCount / 2); // 6 concurrent (was 4)

module.exports = {
  apps: [
    // ==========================================
    // Main Application - Single Fork Instance
    // ==========================================
    // IMPORTANT: must stay exec_mode 'fork' with instances 1.
    // PM2 cannot cluster the npm wrapper (it silently forks N competing
    // processes where only one binds port 3000 — previously left 5 zombie
    // instances). True cluster mode is NOT safe either: WebSocketManager
    // keeps sockets in per-process memory (no Redis pub/sub adapter), so
    // multiple workers would break sendToDevice()/dashboards. One Node
    // process comfortably handles 10k+ WebSocket connections on this box.
    // wait_ready removed: server.js never calls process.send('ready'),
    // so wait_ready:true caused PM2 restart loops (historical ↺30 count).
    {
      name: 'manager',
      script: 'server.js',
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      autorestart: true,
      watch: false,
      kill_timeout: 5000,
      node_args: '--max-old-space-size=4096',
    },

    // ==========================================
    // BullMQ Workers - Optimized Concurrency
    // ==========================================

    // SMS Fetch Worker - HIGH PRIORITY (processes orders every 5 seconds)
    {
      name: 'worker:fetch',
      script: 'workers/fetch-worker.js',
      instances: 2, // 2 instances for high traffic
      max_memory_restart: '1800M', // PM2 auto-restart if memory exceeds 1800MB (10% below heap limit)
      env: {
        BULLMQ_FETCH_ENABLED: 'true',
        BULLMQ_CONCURRENCY_SMS_FETCH: String(highConcurrencyWorkers), // 24 concurrent jobs (was 12)
        BULLMQ_SMS_FETCH_INTERVAL: '1000', // 1 second (was 2) - faster polling
      },
      // Optimized memory for 62GB RAM system
      node_args: '--max-old-space-size=2048', // 2GB heap, PM2 restarts at 1.8GB
    },

    // Device Status Worker - Handles device/number sync every 15 seconds
    {
      name: 'worker:status',
      script: 'workers/status-worker.js',
      instances: 2, // 2 instances for better load distribution
      max_memory_restart: '3500M', // PM2 auto-restart if memory exceeds 3500MB (10% below heap limit)
      env: {
        BULLMQ_STATUS_ENABLED: 'true',
        BULLMQ_CONCURRENCY_DEVICE_STATUS: String(highConcurrencyWorkers), // 24 concurrent (was 12)
      },
      // Optimized memory for 62GB RAM system
      node_args: '--max-old-space-size=4096', // 4GB heap, PM2 restarts at 3.5GB
    },

    // Device Keep-Alive Worker - Prevents devices from going offline
    {
      name: 'worker:keepalive',
      script: 'workers/keepalive-worker.js',
      instances: 1,
      max_memory_restart: '900M', // PM2 auto-restart if memory exceeds 900MB (10% below heap limit)
      env: {
        BULLMQ_KEEPALIVE_ENABLED: 'true',
        BULLMQ_CONCURRENCY_DEVICE_KEEPALIVE: String(mediumConcurrencyWorkers), // 12 concurrent (was 6)
        FCM_KEEP_ALIVE_TARGET_ALL: 'true', // Target all devices instead of just active orders
        FCM_KEEP_ALIVE_COOLDOWN: '3', // 3 minutes between pings
        FCM_KEEP_ALIVE_MIN_HEARTBEAT_AGE: '45', // Only ping if heartbeat > 45 seconds old
        FCM_KEEP_ALIVE_MAX_DEVICES: '1000', // Max devices to process per cycle (to prevent long-running jobs)
        FCM_KEEP_ALIVE_MAX_OFFLINE_HOURS: '48', // Only ping devices seen < 48h; 0 = all (old behavior)
      },
      // Optimized memory for 62GB RAM system
      node_args: '--max-old-space-size=1024', // 1GB heap, PM2 restarts at 900MB
    },

    // Device Wake-Up Worker - Reactively wakes offline devices
    {
      name: 'worker:wakeup',
      script: 'workers/wakeup-worker.js',
      instances: 1,
      max_memory_restart: '450M', // PM2 auto-restart if memory exceeds 450MB (10% below heap limit)
      env: {
        BULLMQ_WAKEUP_ENABLED: 'true',
        BULLMQ_CONCURRENCY_DEVICE_WAKEUP: String(mediumConcurrencyWorkers), // 12 concurrent (was 6)
        FCM_WAKE_UP_OFFLINE_THRESHOLD: '60',
        FCM_WAKE_UP_COOLDOWN: '0',
      },
      // Optimized memory for 62GB RAM system
      node_args: '--max-old-space-size=512', // 512MB heap, PM2 restarts at 450MB
    },

    // Quality Suspend Worker - SMS quality monitoring (every 15 min)
    // DISABLED by user decision (2026-08-19): number suspend system turned off.
    // Do NOT start via `pm2 start ecosystem.config.cjs` — uncomment to re-enable.
    // {
    //   name: 'worker:suspend',
    //   script: 'workers/suspend-worker.js',
    //   instances: 1,
    //   env: {
    //     BULLMQ_SUSPEND_ENABLED: 'true',
    //     BULLMQ_CONCURRENCY_QUALITY_SUSPEND: String(lowConcurrencyWorkers), // 6 concurrent (was 4)
    //     SMS_AUTO_SUSPEND_ENABLED: 'true',
    //     SMS_SUSPEND_THRESHOLD: '0',
    //     SMS_SUSPEND_WINDOW_HOURS: '12',
    //   },
    //   // Increased memory for 62GB RAM
    //   node_args: '--max-old-space-size=512',
    // },

    // Message Cleanup Worker - Maintenance task (every 6 hours)
    {
      name: 'worker:cleanup',
      script: 'workers/cleanup-worker.js',
      instances: 1,
      max_memory_restart: '450M', // PM2 auto-restart if memory exceeds 450MB (10% below heap limit)
      env: {
        BULLMQ_CLEANUP_ENABLED: 'true',
        MESSAGE_CLEANUP_ENABLED: 'true',
        MESSAGE_RETENTION_HOURS: '12',
        MESSAGE_CLEANUP_DRY_RUN: 'false',
        MESSAGE_CLEANUP_BATCH_SIZE: '50000', // Increased from 10000 for much faster cleanup
      },
      // Optimized memory for 62GB RAM system
      node_args: '--max-old-space-size=512', // 512MB heap, PM2 restarts at 450MB
    },
  ],
};
