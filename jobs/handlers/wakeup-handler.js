// jobs/handlers/wakeup-handler.js
import Device from '../../models/Device.js';
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

// Initialize Firebase if not already done
let firebaseInitialized = false;

function ensureFirebaseInitialized() {
  if (firebaseInitialized) return true;

  if (!process.env.FCM_SERVICE_ACCOUNT_KEY) {
    console.log('[Wakeup] FCM_SERVICE_ACCOUNT_KEY not set');
    return false;
  }

  try {
    // Check if already initialized
    const apps = admin.getApps();
    if (apps.length > 0) {
      console.log('[Wakeup] Reusing existing Firebase app');
      firebaseInitialized = true;
      return true;
    }

    // Read service account file
    const serviceAccount = JSON.parse(
      readFileSync(process.env.FCM_SERVICE_ACCOUNT_KEY, 'utf8')
    );

    // Initialize using the default firebase-admin import (CommonJS compatible)
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    firebaseInitialized = true;
    console.log('[Wakeup] Firebase initialized');
    return true;
  } catch (error) {
    console.error('[Wakeup] Failed to initialize Firebase:', error.message);
    return false;
  }
}

export async function handleWakeupJob(data) {
  const startTime = Date.now();
  let processed = 0;
  let errors = 0;
  let notificationsSent = 0;

  try {
    console.log('[Wakeup] Starting wake-up job');
    const { type = 'scheduled', targetDeviceId = null, maxAttempts = 3 } = data;
    const offlineThreshold = parseInt(process.env.FCM_WAKE_UP_OFFLINE_THRESHOLD || '120', 10) * 1000;

    const now = Date.now();
    const cutoffTime = new Date(now - offlineThreshold);

    console.log(`[Wakeup] Looking for devices offline since ${cutoffTime.toISOString()}`);

    // Check if Firebase is available
    console.log('[Wakeup] Checking Firebase initialization...');
    const isReady = ensureFirebaseInitialized();
    if (!isReady) {
      console.log('[Wakeup] Firebase not initialized - skipping wake-up');
      return {
        success: true,
        processed: 0,
        errors: 0,
        duration: Date.now() - startTime,
        details: {
          offlineDevicesFound: 0,
          devicesWithValidTokens: 0,
          notificationsSent: 0,
          skipped: 'Firebase not initialized',
        },
      };
    }

    let query = {
      isActive: true,
      lastHeartbeat: { $lt: cutoffTime },
      fcmToken: { $ne: null, $ne: '' },
    };

    if (targetDeviceId) {
      query.deviceId = targetDeviceId;
    }

    const offlineDevices = await Device.find(query).limit(maxAttempts);

    // Filter out devices with invalid FCM tokens
    const devicesToWake = offlineDevices.filter(device =>
      device.fcmToken && device.fcmToken.length > 0
    );

    console.log(`[Wakeup] Found ${offlineDevices.length} offline devices, ${devicesToWake.length} with valid FCM tokens`);

    for (const device of devicesToWake) {
      processed++;

      try {
        const message = {
          token: device.fcmToken,
          data: {
            type: 'wakeup',
            server_timestamp: new Date().toISOString()
          },
          android: {
            priority: 'high',
            ttl: 0
          },
        };

        await messaging.send(message);
        notificationsSent++;

        console.log(`[Wakeup] Sent notification to device ${device.deviceId}`);
      } catch (err) {
        errors++;
        console.error(`[Wakeup] Failed to send to ${device.deviceId}:`, err.message);
        // Log full error for debugging
        if (err.code) {
          console.error(`[Wakeup] Error code: ${err.code}`);
        }
      }
    }

    return {
      success: true,
      processed,
      errors,
      duration: Date.now() - startTime,
      details: {
        offlineDevicesFound: offlineDevices.length,
        devicesWithValidTokens: devicesToWake.length,
        notificationsSent,
      },
    };
  } catch (error) {
    console.error('[Wakeup] Error in handler:', error.message);
    console.error('[Wakeup] Stack:', error.stack);
    return {
      success: false,
      processed,
      errors: errors + 1,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}
