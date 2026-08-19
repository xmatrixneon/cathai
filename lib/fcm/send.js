/**
 * FCM Send Functions
 *
 * Functions for sending FCM notifications to Android devices.
 * Used primarily for remote wake-up functionality.
 */

import { getFirebaseApp, isFcmReady } from './index.js';
import { getMessaging } from 'firebase-admin/messaging';

/**
 * FCM error codes that mean the token is permanently invalid and can never
 * succeed. Covers both legacy and modern firebase-admin error codes:
 * - messaging/unregistered                          (modern HTTP v1 API)
 * - messaging/registration-token-not-registered     (legacy HTTP API)
 * - messaging/invalid-registration-token            (malformed token)
 * - messaging/sender-id-mismatch                    (token from another Firebase project)
 * - messaging/invalid-argument                      (bad token argument)
 * - messaging/internal-error                        (typically invalid token format/expired)
 *
 * Single source of truth — imported by keepalive/wakeup handlers so stale
 * tokens are consistently detected and removed everywhere.
 *
 * @param {Error} error - Error thrown by firebase-admin messaging send()
 * @returns {boolean} - True if the token is stale and should be removed
 */
export function isStaleFcmTokenError(error) {
  // firebase-admin exposes the code on error.code and/or error.errorInfo.code
  const code = error?.code || error?.errorInfo?.code;
  if (!code) return false;
  return [
    'messaging/unregistered',
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
    'messaging/sender-id-mismatch',
    'messaging/invalid-argument',
    'messaging/internal-error',
  ].includes(code);
}

/**
 * Send a wake-up notification to a device.
 *
 * @param {string} deviceId - The device ID to wake up
 * @param {string} fcmToken - The FCM token for the device
 * @returns {Promise<{success: boolean, isStaleToken: boolean}>} - Result object with success status and stale token flag
 */
export async function sendWakeUpNotification(deviceId, fcmToken) {
  if (!fcmToken) {
    console.warn('[FCM] No FCM token provided - cannot send wake-up notification');
    return { success: false, isStaleToken: false };
  }

  // Get Firebase app (initializes if needed for API route context)
  const firebaseApp = getFirebaseApp();
  if (!firebaseApp) {
    console.warn('[FCM] Firebase not initialized - cannot send wake-up notification');
    return { success: false, isStaleToken: false };
  }

  try {
    const message = {
      token: fcmToken,
      data: {
        type: 'wakeup',
        server_timestamp: new Date().toISOString()
      },
      android: {
        priority: 'high',
        ttl: 0 // Message must be delivered now or not at all
      },
      // No notification payload - we want a silent data message
      // that triggers onMessageReceived() in the app
    };

    const response = await getMessaging(firebaseApp).send(message);
    // console.log(`[FCM] Wake-up notification sent to device ${deviceId}:`, response);
    return { success: true, isStaleToken: false };

  } catch (error) {
    if (isStaleFcmTokenError(error)) {
      // console.warn(`[FCM] Device ${deviceId} has stale FCM token (${error.code || error?.errorInfo?.code})`);
      return { success: false, isStaleToken: true };
    }
    console.error(`[FCM] Failed to send wake-up to device ${deviceId}:`, error);
    return { success: false, isStaleToken: false };
  }
}

/**
 * Send a custom data message to a device.
 *
 * @param {string} fcmToken - The FCM token for the device
 * @param {Object} data - Custom data to send
 * @returns {Promise<boolean>} - True if message sent successfully
 */
export async function sendToDevice(fcmToken, data) {
  const firebaseApp = getFirebaseApp();
  if (!firebaseApp) {
    console.warn('[FCM] Firebase not initialized');
    return false;
  }

  try {
    const message = {
      token: fcmToken,
      data: data,
      android: {
        priority: 'high'
      }
    };

    const response = await getMessaging(firebaseApp).send(message);
    // console.log('[FCM] Message sent:', response);
    return true;

  } catch (error) {
    console.error('[FCM] Failed to send message:', error);
    return false;
  }
}

export default {
  sendWakeUpNotification,
  sendToDevice
};
