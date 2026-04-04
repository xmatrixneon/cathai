module.exports = {
  apps: [{
    name: 'manager',
    script: 'npm',
    args: 'start'
  }, {
    name: 'manager:numberstatus',
    script: 'script/status.mjs'
  }, {
    name: 'manager:fetchsms',
    script: 'script/fetch.mjs'
  }, {
    name: 'manager:suspendlowsms',
    script: 'script/suspend-low-sms.mjs',
    env: {
      SMS_AUTO_SUSPEND_ENABLED: 'true',
      SMS_SUSPEND_THRESHOLD: '0',
      SMS_SUSPEND_WINDOW_HOURS: '12'
    }
  }, {
    name: 'manager:wakeup',
    script: 'script/wakeup.mjs'
  }, {
    name: 'manager:cleanup-messages',
    script: 'script/cleanup-messages.mjs',
    env: {
      MESSAGE_CLEANUP_ENABLED: 'true',
      MESSAGE_RETENTION_HOURS: '12',
      MESSAGE_CLEANUP_DRY_RUN: 'false',
      MESSAGE_CLEANUP_BATCH_SIZE: '1000'
    }
  }]
};
