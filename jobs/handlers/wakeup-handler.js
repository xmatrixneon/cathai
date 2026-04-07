// jobs/handlers/wakeup-handler.js
import Device from '../../models/Device.js';
import admin from 'firebase-admin';

// Initialize Firebase if not already done
let firebaseInitialized = false;
function ensureFirebaseInitialized() {
  if (!firebaseInitialized && process.env.FCM_SERVICE_ACCOUNT_KEY) {
    const serviceAccount = JSON.parse(
      require('fs').readFileSync(process.env.FCM_SERVICE_ACCOUNT_KEY, 'utf8')
    );
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    firebaseInitialized = true;
  }
}

export async function handleWakeupJob(data) {
  const startTime = Date.now();
  let processed = 0;
  let errors = 0;
  let notificationsSent = 0;

  try {
    const { type = 'scheduled', targetDeviceId = null, maxAttempts = 3 } = data;
    const offlineThreshold = parseInt(process.env.FCM_WAKE_UP_OFFLINE_THRESHOLD || '120', 10) * 1000;
    const cooldownMinutes = parseInt(process.env.FCM_WAKE_UP_COOLDOWN || '5', 10);
    const cooldownMs = cooldownMinutes * 60 * 1000;

    ensureFirebaseInitialized();

    const now = Date.now();
    const cutoffTime = new Date(now - offlineThreshold);
    const cooldownCutoff = new Date(now - cooldownMs);

    console.log(`[Wakeup] Looking for devices offline since ${cutoffTime.toISOString()}`);

    let query = {
      lastHeartbeat: { $lt: cutoffTime },
      'fcmToken.0': { $exists: true },
    };

    if (targetDeviceId) {
      query.deviceId = targetDeviceId;
    }

    const offlineDevices = await Device.find(query).limit(maxAttempts);

    // Filter out devices recently attempted
    const devicesToWake = offlineDevices.filter(device => {
      if (!device.lastWakeupAttempt) return true;
      return device.lastWakeupAttempt < cooldownCutoff;
    });

    for (const device of devicesToWake) {
      processed++;

      try {
        const message = {
          token: device.fcmToken,
          notification: {
            title: 'Wake Up',
            body: 'SMS Gateway needs your attention',
          },
          android: {
            priority: 'high',
          },
          apns: {
            payload: {
              aps: {
                contentAvailable: true,
                priority: 10,
              },
            },
          },
        };

        await admin.messaging().send(message);
        notificationsSent++;

        await Device.updateOne(
          { _id: device._id },
          { $set: { lastWakeupAttempt: new Date() } }
        );

        console.log(`[Wakeup] Sent notification to device ${device.deviceId}`);
      } catch (err) {
        errors++;
        console.error(`[Wakeup] Failed to send to ${device.deviceId}:`, err.message);
      }
    }

    return {
      success: true,
      processed,
      errors,
      duration: Date.now() - startTime,
      details: {
        offlineDevicesFound: offlineDevices.length,
        notificationsSent,
        cooldownMinutes,
      },
    };
  } catch (error) {
    return {
      success: false,
      processed,
      errors: errors + 1,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}
