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
    // BullMQ Workers
    // ==========================================
    {
      name: 'worker:fetch',
      script: 'workers/fetch-worker.js',
      env: {
        BULLMQ_FETCH_ENABLED: 'true',
        BULLMQ_CONCURRENCY_SMS_FETCH: '5',
        BULLMQ_SMS_FETCH_INTERVAL: '2000',
      },
    },
    {
      name: 'worker:status',
      script: 'workers/status-worker.js',
      env: {
        BULLMQ_STATUS_ENABLED: 'true',
        BULLMQ_CONCURRENCY_DEVICE_STATUS: '3',
      },
    },
    {
      name: 'worker:keepalive',
      script: 'workers/keepalive-worker.js',
      env: {
        BULLMQ_KEEPALIVE_ENABLED: 'true',
        BULLMQ_CONCURRENCY_DEVICE_KEEPALIVE: '2',
      },
    },
    {
      name: 'worker:suspend',
      script: 'workers/suspend-worker.js',
      env: {
        BULLMQ_SUSPEND_ENABLED: 'true',
        BULLMQ_CONCURRENCY_QUALITY_SUSPEND: '2',
        SMS_AUTO_SUSPEND_ENABLED: 'true',
        SMS_SUSPEND_THRESHOLD: '0',
        SMS_SUSPEND_WINDOW_HOURS: '12',
      },
    },
    {
      name: 'worker:cleanup',
      script: 'workers/cleanup-worker.js',
      env: {
        BULLMQ_CLEANUP_ENABLED: 'true',
        MESSAGE_CLEANUP_ENABLED: 'true',
        MESSAGE_RETENTION_HOURS: '12',
        MESSAGE_CLEANUP_DRY_RUN: 'false',
        MESSAGE_CLEANUP_BATCH_SIZE: '1000'
      },
    },
    {
      name: 'worker:wakeup',
      script: 'workers/wakeup-worker.js',
      env: {
        BULLMQ_WAKEUP_ENABLED: 'true',
        BULLMQ_CONCURRENCY_DEVICE_WAKEUP: '2',
        FCM_WAKE_UP_OFFLINE_THRESHOLD: '60',
        FCM_WAKE_UP_COOLDOWN: '0',
      },
    },
  ],
};
