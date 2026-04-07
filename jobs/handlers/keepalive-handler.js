// jobs/handlers/keepalive-handler.js
import Device from '../../models/Device.js';
import Numbers from '../../models/Numbers.js';
import Orders from '../../models/Orders.js';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { cert } from 'firebase-admin/app';
import { readFileSync } from 'fs';

// Configuration
const COOLDOWN_MINUTES = parseInt(process.env.FCM_KEEP_ALIVE_COOLDOWN || "3");
const MIN_HEARTBEAT_AGE_SECONDS = parseInt(process.env.FCM_KEEP_ALIVE_MIN_HEARTBEAT_AGE || "45");

// Track keep-alive attempts to avoid spamming
const keepAliveAttempts = new Map();

/**
 * Initialize Firebase Admin SDK
 */
let firebaseApp = null;

function getFirebaseApp() {
  if (firebaseApp) return firebaseApp;

  const apps = getApps();
  if (apps.length > 0) {
    firebaseApp = apps[0];
    return firebaseApp;
  }

  const serviceAccountPath = process.env.FCM_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountPath) {
    console.warn('[Keepalive] FCM_SERVICE_ACCOUNT_KEY not set - keep-alive disabled');
    return null;
  }

  try {
    const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
    firebaseApp = initializeApp({ credential: cert(serviceAccount) });
    return firebaseApp;
  } catch (error) {
    console.error('[Keepalive] Failed to initialize Firebase:', error.message);
    return null;
  }
}

/**
 * Find devices that have active orders
 */
async function findDevicesWithActiveOrders() {
  // Step 1: Get all active orders
  const activeOrders = await Orders.find({ active: true }, { number: 1 });

  if (activeOrders.length === 0) {
    console.log(`   ✅ No active orders found`);
    return [];
  }

  console.log(`   📋 Found ${activeOrders.length} active order(s)`);

  // Step 2: Extract unique phone numbers (deduplicate at order level)
  const phoneNumbers = [...new Set(activeOrders.map(order => order.number))];
  console.log(`      Unique phone numbers: ${phoneNumbers.length}`);

  // Step 3: Lookup numbers collection to get ports
  const numbers = await Numbers.find(
    { number: { $in: phoneNumbers }, active: true },
    { number: 1, port: 1 }
  );

  if (numbers.length === 0) {
    console.log(`   ⚠️  No active numbers found for these orders`);
    return [];
  }

  console.log(`      Active numbers: ${numbers.length}`);

  // Step 4: Parse port field to extract device IDs (deduplicate at port level)
  const deviceIds = new Set();
  for (const num of numbers) {
    if (num.port) {
      // Port format: {deviceId}-SIM{slot}
      // Extract device ID by removing -SIM{slot} suffix
      const deviceId = num.port.replace(/-SIM\d+$/, '');
      if (deviceId) {
        deviceIds.add(deviceId);
      }
    }
  }

  if (deviceIds.size === 0) {
    console.log(`   ⚠️  No valid ports found for these numbers`);
    return [];
  }

  console.log(`      Unique device IDs: ${deviceIds.size}`);

  // Step 5: Lookup devices with these IDs and valid FCM tokens
  const deviceIdArray = Array.from(deviceIds);
  const devices = await Device.find({
    deviceId: { $in: deviceIdArray },
    isActive: true,
    fcmToken: { $ne: null, $ne: "" }
  });

  if (devices.length === 0) {
    console.log(`   ⚠️  No devices with valid FCM tokens found`);
    return [];
  }

  console.log(`      Devices with FCM tokens: ${devices.length}`);

  return devices;
}

/**
 * Check if a device can receive a keep-alive ping
 */
function canSendKeepAlive(device) {
  const now = Date.now();
  const attempts = keepAliveAttempts.get(device.deviceId);

  if (!attempts) {
    return true; // Never attempted, can send
  }

  const timeSinceLastAttempt = (now - attempts.lastAttempt) / 1000 / 60; // in minutes

  // Check cooldown period
  if (timeSinceLastAttempt < COOLDOWN_MINUTES) {
    return false; // Still in cooldown
  }

  return true; // Cooldown has passed, can send
}

/**
 * Record a keep-alive attempt
 */
function recordKeepAliveAttempt(deviceId) {
  const now = Date.now();
  keepAliveAttempts.set(deviceId, {
    lastAttempt: now
  });
}

/**
 * Send keep-alive notification to a device
 */
async function sendKeepAlivePing(device) {
  const firebaseApp = getFirebaseApp();
  if (!firebaseApp) {
    return { success: false, isStaleToken: false };
  }

  try {
    const message = {
      token: device.fcmToken,
      data: {
        type: 'keepalive',
        server_timestamp: new Date().toISOString()
      },
      android: {
        priority: 'high',
        ttl: 0
      },
    };

    await getMessaging(firebaseApp).send(message);
    console.log(`      FCM Token: ${device.fcmToken.substring(0, 20)}...`);
    return { success: true, isStaleToken: false };

  } catch (error) {
    // Check if token is unregistered
    if (error.code === 'messaging/registration-token-not-registered') {
      return { success: false, isStaleToken: true };
    }
    console.log(`      Error: ${error.message}`);
    return { success: false, isStaleToken: false };
  }
}

/**
 * Process devices with active orders and send keep-alive pings
 */
async function sendKeepAlivePings() {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🔄 FCM KEEP-ALIVE SCAN  ${timestamp}`);
  console.log(`${'═'.repeat(60)}`);

  try {
    const devices = await findDevicesWithActiveOrders();

    if (devices.length === 0) {
      console.log(`${'═'.repeat(60)}\n`);
      return {
        success: true,
        notificationsSent: 0,
        skipped: 0,
        staleTokensRemoved: 0,
        failed: 0
      };
    }

    console.log(`   Minimum heartbeat age: ${MIN_HEARTBEAT_AGE_SECONDS}s`);
    console.log(`   Cooldown period: ${COOLDOWN_MINUTES} minutes`);
    console.log(`${'─'.repeat(60)}`);

    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;
    let staleTokenCount = 0;
    let tooRecentCount = 0;

    for (const device of devices) {
      // Check heartbeat age
      const heartbeatAge = Math.floor((Date.now() - new Date(device.lastHeartbeat).getTime()) / 1000);

      // Skip if heartbeat is too recent (device is actively maintaining connection)
      if (heartbeatAge < MIN_HEARTBEAT_AGE_SECONDS) {
        console.log(`   ⏭️  SKIP     ${device.deviceId} (${device.name || 'unnamed'})`);
        console.log(`      Reason: Heartbeat too recent (${heartbeatAge}s ago < ${MIN_HEARTBEAT_AGE_SECONDS}s minimum)`);
        tooRecentCount++;
        continue;
      }

      // Check cooldown
      if (!canSendKeepAlive(device)) {
        const attempts = keepAliveAttempts.get(device.deviceId);
        const timeSinceLastAttempt = Math.floor((Date.now() - attempts?.lastAttempt || 0) / 1000 / 60);
        console.log(`   ⏭️  SKIP     ${device.deviceId} (${device.name || 'unnamed'})`);
        console.log(`      Reason: In cooldown (${timeSinceLastAttempt}/${COOLDOWN_MINUTES} minutes)`);
        skipCount++;
        continue;
      }

      console.log(`   📡 KEEP-ALIVE ${device.deviceId} (${device.name || 'unnamed'})`);
      console.log(`      Status: ${device.status}, Heartbeat age: ${heartbeatAge}s ago`);

      // Send FCM keep-alive notification
      const result = await sendKeepAlivePing(device);

      if (result.success) {
        recordKeepAliveAttempt(device.deviceId);
        successCount++;
        console.log(`      ✅ Keep-alive sent successfully`);
      } else if (result.isStaleToken) {
        staleTokenCount++;
        // Mark device as having no valid FCM token
        await Device.updateOne(
          { deviceId: device.deviceId },
          { $unset: { fcmToken: "", fcmTokenUpdatedAt: "" } }
        );
        console.log(`      ⚠️  Stale FCM token removed`);
      } else {
        failCount++;
        console.log(`      ❌ Failed to send keep-alive`);
      }

      console.log();
    }

    const elapsed = Date.now() - startTime;

    console.log(`${'─'.repeat(60)}`);
    console.log(`📊 SUMMARY  (${elapsed}ms)`);
    console.log(`   ✅ Success: ${successCount} device(s) pinged`);
    console.log(`   ⏭️  Skipped: ${skipCount} device(s) (cooldown)`);
    console.log(`   ⏰  Too recent: ${tooRecentCount} device(s) (heartbeat)`);
    console.log(`   ⚠️  Stale tokens removed: ${staleTokenCount} device(s)`);
    console.log(`   ❌ Failed:  ${failCount} device(s)`);
    console.log(`${'═'.repeat(60)}\n`);

    return {
      success: true,
      notificationsSent: successCount,
      skipped: skipCount + tooRecentCount,
      staleTokensRemoved: staleTokenCount,
      failed: failCount
    };

  } catch (err) {
    console.error(`❌ KEEP-ALIVE ERROR: ${err.message}`);
    console.error(`   ${err.stack}\n`);
    return {
      success: false,
      notificationsSent: 0,
      skipped: 0,
      staleTokensRemoved: 0,
      failed: 0,
      error: err.message
    };
  }
}

/**
 * Clean up old keep-alive attempt records
 */
function cleanupOldAttempts() {
  const now = Date.now();
  const maxAge = COOLDOWN_MINUTES * 2 * 60 * 1000; // 2x cooldown period

  for (const [deviceId, attempt] of keepAliveAttempts.entries()) {
    if (now - attempt.lastAttempt > maxAge) {
      keepAliveAttempts.delete(deviceId);
    }
  }
}

export async function handleKeepaliveJob(data) {
  const startTime = Date.now();
  let errors = 0;

  try {
    console.log('[Keepalive] Starting FCM keep-alive job');

    // Run cleanup of old attempts
    cleanupOldAttempts();

    // Send keep-alive pings
    const result = await sendKeepAlivePings();

    return {
      success: result.success,
      processed: result.notificationsSent + result.skipped + result.failed,
      errors: result.success ? 0 : 1,
      duration: Date.now() - startTime,
      details: result
    };

  } catch (error) {
    errors++;
    console.error('[Keepalive] Error:', error.message);
    return {
      success: false,
      processed: 0,
      errors,
      duration: Date.now() - startTime,
      error: error.message
    };
  }
}
