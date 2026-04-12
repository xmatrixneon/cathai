// ecosystem.config.cjs - Auto-scaled configuration for 12-core / 62GB RAM VPS
// Scaling strategy based on available hardware resources

const os = require('os');

// Hardware detection
const cpuCount = os.cpus().length; // 12 cores
const totalMemGB = os.totalmem() / (1024 ** 3); // ~62GB

// Scaling calculations for 12-core / 62GB system
const managerInstances = Math.floor(cpuCount / 2); // 6 instances for 12 cores (optimal for Node.js cluster)
const highConcurrencyWorkers = cpuCount; // 12 for heavy workers (was 6)
const mediumConcurrencyWorkers = Math.floor(cpuCount / 2); // 6 for medium workers (was 4)

module.exports = {
  apps: [
    // ==========================================
    // Main Application - Cluster Mode
    // ==========================================
    {
      name: 'manager',
      script: 'npm',
      args: 'start',
      instances: managerInstances,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      // Auto-restart configuration
      autorestart: true,
      watch: false,
      // No memory limit restart - VPS has 62GB RAM, processes use ~1.3GB total
      // Graceful shutdown
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,
      // Cluster optimizations
      node_args: '--max-old-space-size=2048',
    },

    // ==========================================
    // BullMQ Workers - Optimized Concurrency
    // ==========================================

    // SMS Fetch Worker - HIGH PRIORITY (processes orders every 5 seconds)
    {
      name: 'worker:fetch',
      script: 'workers/fetch-worker.js',
      instances: 1,
      env: {
        BULLMQ_FETCH_ENABLED: 'true',
        BULLMQ_CONCURRENCY_SMS_FETCH: String(highConcurrencyWorkers), // 12 concurrent jobs (was 6)
        BULLMQ_SMS_FETCH_INTERVAL: '2000', // 2 seconds (faster polling)
      },
      // No memory limit restart - VPS has 62GB RAM
      node_args: '--max-old-space-size=1024',
    },

    // Device Status Worker - Handles device/number sync every 15 seconds
    {
      name: 'worker:status',
      script: 'workers/status-worker.js',
      instances: 1,
      env: {
        BULLMQ_STATUS_ENABLED: 'true',
        BULLMQ_CONCURRENCY_DEVICE_STATUS: String(mediumConcurrencyWorkers), // 6 concurrent (was 4)
      },
      // No memory limit restart - VPS has 62GB RAM
      node_args: '--max-old-space-size=2048',
    },

    // Device Keep-Alive Worker - Prevents devices from going offline
    {
      name: 'worker:keepalive',
      script: 'workers/keepalive-worker.js',
      instances: 1,
      env: {
        BULLMQ_KEEPALIVE_ENABLED: 'true',
        BULLMQ_CONCURRENCY_DEVICE_KEEPALIVE: String(mediumConcurrencyWorkers), // 6 concurrent (was 4)
      },
      // No memory limit restart - VPS has 62GB RAM
      node_args: '--max-old-space-size=512',
    },

    // Device Wake-Up Worker - Reactively wakes offline devices
    {
      name: 'worker:wakeup',
      script: 'workers/wakeup-worker.js',
      instances: 1,
      env: {
        BULLMQ_WAKEUP_ENABLED: 'true',
        BULLMQ_CONCURRENCY_DEVICE_WAKEUP: String(mediumConcurrencyWorkers), // 6 concurrent (was 4)
        FCM_WAKE_UP_OFFLINE_THRESHOLD: '60',
        FCM_WAKE_UP_COOLDOWN: '0',
      },
      // No memory limit restart - VPS has 62GB RAM
      node_args: '--max-old-space-size=512',
    },

    // Quality Suspend Worker - SMS quality monitoring (every 15 min)
    {
      name: 'worker:suspend',
      script: 'workers/suspend-worker.js',
      instances: 1,
      env: {
        BULLMQ_SUSPEND_ENABLED: 'true',
        BULLMQ_CONCURRENCY_QUALITY_SUSPEND: '4', // Increased from 2
        SMS_AUTO_SUSPEND_ENABLED: 'true',
        SMS_SUSPEND_THRESHOLD: '0',
        SMS_SUSPEND_WINDOW_HOURS: '12',
      },
      // No memory limit restart - VPS has 62GB RAM
      node_args: '--max-old-space-size=300',
    },

    // Message Cleanup Worker - Maintenance task (every 6 hours)
    {
      name: 'worker:cleanup',
      script: 'workers/cleanup-worker.js',
      instances: 1,
      env: {
        BULLMQ_CLEANUP_ENABLED: 'true',
        MESSAGE_CLEANUP_ENABLED: 'true',
        MESSAGE_RETENTION_HOURS: '12',
        MESSAGE_CLEANUP_DRY_RUN: 'false',
        MESSAGE_CLEANUP_BATCH_SIZE: '10000', // Increased from 5000 for faster cleanup
      },
      // No memory limit restart - VPS has 62GB RAM
      node_args: '--max-old-space-size=512',
    },
  ],
};
