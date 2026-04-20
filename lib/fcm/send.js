/**
 * FCM Send Functions
 *
 * Functions for sending FCM notifications to Android devices.
 * Used primarily for remote wake-up functionality.
 */

import { getFirebaseApp, isFcmReady } from './index.js';
import { getMessaging } from 'firebase-admin/messaging';

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
    // Handle specific FCM errors
    if (error.code === 'messaging/registration-token-not-registered') {
      // console.warn(`[FCM] Device ${deviceId} has unregistered FCM token - token may be stale`);
      return { success: false, isStaleToken: true };
    } else if (error.code === 'messaging/invalid-argument') {
      console.error(`[FCM] Invalid FCM token for device ${deviceId}:`, error.message);
      return { success: false, isStaleToken: true };
    } else if (error.code === 'messaging/internal-error') {
      // Internal error typically means invalid token format or expired token
      console.warn(`[FCM] Internal error for device ${deviceId} - treating as stale token`);
      return { success: false, isStaleToken: true };
    } else {
      console.error(`[FCM] Failed to send wake-up to device ${deviceId}:`, error);
    }
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
