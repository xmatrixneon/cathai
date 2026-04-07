// jobs/handlers/keepalive-handler.js
import Device from '../../models/Device.js';
import Numbers from '../../models/Numbers.js';
import Orders from '../../models/Orders.js';

// Track keep-alive attempts in memory
const keepAliveAttempts = new Map();

function canSendKeepAlive(device, cooldownMs) {
  const now = Date.now();
  const attempts = keepAliveAttempts.get(device.deviceId);

  if (!attempts) {
    return true;
  }

  const timeSinceLastAttempt = now - attempts.lastAttempt;
  return timeSinceLastAttempt >= cooldownMs;
}

function recordKeepAliveAttempt(deviceId) {
  keepAliveAttempts.set(deviceId, { lastAttempt: Date.now() });
}

export async function handleKeepaliveJob(data) {
  const startTime = Date.now();
  let processed = 0;
  let errors = 0;
  let notificationsSent = 0;

  try {
    const { cooldownMinutes = 3, minHeartbeatAgeSeconds = 45 } = data;
    const cooldownMs = cooldownMinutes * 60 * 1000;
    const minHeartbeatAgeMs = minHeartbeatAgeSeconds * 1000;

    console.log('[Keepalive] Starting keep-alive job');

    // Get active orders
    const activeOrders = await Orders.find({ active: true });

    if (activeOrders.length === 0) {
      console.log('[Keepalive] No active orders');
      return {
        success: true,
        processed: 0,
        errors: 0,
        duration: Date.now() - startTime,
        details: {
          activeOrders: 0,
          notificationsSent: 0,
        },
      };
    }

    // Get unique phone numbers
    const phoneNumbers = [...new Set(activeOrders.map(order => order.number))];

    // Get active numbers for these phone numbers
    const numbers = await Numbers.find({
      number: { $in: phoneNumbers },
      active: true
    });

    if (numbers.length === 0) {
      console.log('[Keepalive] No active numbers found');
      return {
        success: true,
        processed: 0,
        errors: 0,
        duration: Date.now() - startTime,
        details: {
          activeOrders: activeOrders.length,
          notificationsSent: 0,
        },
      };
    }

    // Extract device IDs from ports
    const deviceIds = new Set();
    for (const num of numbers) {
      if (num.port) {
        const deviceId = num.port.replace(/-SIM\d+$/, '');
        if (deviceId) {
          deviceIds.add(deviceId);
        }
      }
    }

    // Get devices with FCM tokens
    const devices = await Device.find({
      deviceId: { $in: Array.from(deviceIds) },
      isActive: true,
      fcmToken: { $ne: null, $ne: '' }
    });

    console.log(`[Keepalive] Active orders: ${activeOrders.length}, Devices to ping: ${devices.length}`);

    for (const device of devices) {
      processed++;

      // Check if device needs keep-alive (heartbeat older than threshold)
      const heartbeatAge = Date.now() - new Date(device.lastHeartbeat).getTime();
      if (heartbeatAge < minHeartbeatAgeMs) {
        continue;
      }

      // Check cooldown
      if (!canSendKeepAlive(device, cooldownMs)) {
        continue;
      }

      // Send FCM keep-alive (simple data message)
      try {
        const admin = (await import('firebase-admin')).default;
        const app = admin.getApps()[0];
        if (!app) {
          console.log('[Keepalive] Firebase not initialized');
          continue;
        }

        const message = {
          token: device.fcmToken,
          data: {
            type: 'keepalive',
            timestamp: new Date().toISOString()
          },
          android: {
            priority: 'high',
            ttl: 0
          },
        };

        await admin.messaging().send(app, message);
        notificationsSent++;
        recordKeepAliveAttempt(device.deviceId);
        console.log(`[Keepalive] Sent to ${device.deviceId}`);
      } catch (err) {
        errors++;
        console.error(`[Keepalive] Failed for ${device.deviceId}:`, err.message);
      }
    }

    return {
      success: true,
      processed,
      errors,
      duration: Date.now() - startTime,
      details: {
        activeOrders: activeOrders.length,
        devicesFound: devices.length,
        notificationsSent,
      },
    };
  } catch (error) {
    errors++;
    console.error('[Keepalive] Error:', error.message);
    return {
      success: false,
      processed,
      errors,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}
