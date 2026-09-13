// jobs/handlers/wakeup-handler.js
import Device from '../../models/Device.js';
import { sendWakeUpNotification } from '../../lib/fcm/send.js';
import { initializeFirebase } from '../../lib/fcm/index.js';

export async function handleWakeupJob(data) {
  const startTime = Date.now();
  let processed = 0;
  let errors = 0;
  let notificationsSent = 0;
  let staleTokensRemoved = 0;

  try {
    const { type = 'scheduled', targetDeviceId = null } = data;
    const offlineThreshold = parseInt(process.env.FCM_WAKE_UP_OFFLINE_THRESHOLD || '120', 10) * 1000;
    const cooldownMinutes = parseInt(process.env.FCM_WAKE_UP_COOLDOWN || '5', 10);
    const cooldownMs = cooldownMinutes * 60 * 1000;

    // Initialize Firebase (safe to call multiple times)
    initializeFirebase();

    const now = Date.now();
    const cutoffTime = new Date(now - offlineThreshold);
    const cooldownCutoff = new Date(now - cooldownMs);

    // Devices silent longer than this almost never come back (uninstalled /
    // factory reset) and their tokens are usually stale — pinging them only
    // burns FCM quota. 0 = no cap.
    const maxOfflineHours = parseInt(process.env.FCM_WAKE_UP_MAX_OFFLINE_HOURS || '48', 10);

    // Build query for offline devices with FCM tokens
    // $nin (not duplicate $ne keys) — JS object literals silently keep only
    // the last duplicate key, which matched empty-string tokens.
    let query = {
      isActive: true,
      lastHeartbeat: { $lt: cutoffTime },
      fcmToken: { $exists: true, $nin: [null, ''] },
    };
    if (maxOfflineHours > 0) {
      query.lastHeartbeat.$gte = new Date(now - maxOfflineHours * 60 * 60 * 1000);
    }

    if (targetDeviceId) {
      query.deviceId = targetDeviceId;
    }

    // Only the fields the ping loop needs — full Device docs for 17k+
    // offline devices ballooned worker memory toward the PM2 restart limit.
    // Newest-offline first: a device that JUST dropped (most likely holding
    // a pending OTP order) is pinged this cycle instead of waiting behind
    // long-offline devices.
    const offlineDevices = await Device.find(query)
      .select('deviceId fcmToken lastWakeupAttempt')
      .sort({ lastHeartbeat: -1 })
      .lean();

    // Filter out devices recently attempted (respect cooldown)
    // Skip cooldown check if cooldownMinutes is 0 (retry every cycle)
    const eligible = offlineDevices.filter(device => {
      if (cooldownMinutes === 0) return true;  // No cooldown - always wake up
      if (!device.lastWakeupAttempt) return true;
      return device.lastWakeupAttempt < cooldownCutoff;
    });

    // Hard cap per cycle so a job finishes in minutes, not half an hour —
    // cooldown rotation brings the rest through subsequent cycles.
    const maxDevices = parseInt(process.env.FCM_WAKE_UP_MAX_DEVICES || '2000', 10);
    const devicesToWake = maxDevices > 0 ? eligible.slice(0, maxDevices) : eligible;

    console.log(
      `[Wakeup] Starting: ${devicesToWake.length} devices to wake (offline threshold: ${offlineThreshold/1000}s` +
      `${maxOfflineHours > 0 ? `, <${maxOfflineHours}h` : ''}, cooldown: ${cooldownMinutes}m` +
      `${devicesToWake.length < eligible.length ? `, capped from ${eligible.length}` : ''})`
    );

    if (devicesToWake.length === 0) {
      console.log(`[Wakeup] No devices to wake`);
      return {
        success: true,
        processed: 0,
        errors: 0,
        duration: Date.now() - startTime,
        details: {
          offlineDevicesFound: offlineDevices.length,
          devicesEligible: 0,
          notificationsSent: 0,
          staleTokensRemoved: 0,
          cooldownMinutes,
        },
      };
    }

    // Process devices serially, but buffer the DB writes: one bulkWrite at
    // the end instead of an updateOne round-trip per device (roughly halves
    // cycle time at fleet scale).
    const bulkOps = [];
    for (const device of devicesToWake) {
      processed++;

      try {
        const result = await sendWakeUpNotification(device.deviceId, device.fcmToken);

        if (result.success) {
          notificationsSent++;
          bulkOps.push({
            updateOne: {
              filter: { _id: device._id },
              update: { $set: { lastWakeupAttempt: new Date() } },
            },
          });
        } else if (result.isStaleToken) {
          errors++;
          staleTokensRemoved++;
          // Remove stale FCM token so device isn't retried in future cycles
          bulkOps.push({
            updateOne: {
              filter: { _id: device._id },
              update: { $unset: { fcmToken: '', fcmTokenUpdatedAt: '' } },
            },
          });
        } else {
          errors++;
        }
      } catch (err) {
        errors++;
      }
    }

    if (bulkOps.length > 0) {
      await Device.bulkWrite(bulkOps, { ordered: false });
    }

    // Summary log
    const duration = Date.now() - startTime;
    console.log(`[Wakeup] Completed: ${notificationsSent} sent, ${staleTokensRemoved} stale tokens removed, ${errors} failed (${duration}ms)`);

    return {
      success: true,
      processed,
      errors,
      duration,
      details: {
        offlineDevicesFound: offlineDevices.length,
        devicesEligible: devicesToWake.length,
        notificationsSent,
        staleTokensRemoved,
        cooldownMinutes,
      },
    };
  } catch (error) {
    console.error(`[Wakeup] Error:`, error.message);
    return {
      success: false,
      processed,
      errors: errors + 1,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}
