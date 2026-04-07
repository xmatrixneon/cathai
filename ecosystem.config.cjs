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
