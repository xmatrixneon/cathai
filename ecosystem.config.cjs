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
  }]
};
