/**
 * FCM Wake-Up Script
 *
 * Automatically sends FCM wake-up notifications to devices that have gone offline.
 * This helps maintain connectivity for devices that Android has killed in the background.
 *
 * Features:
 * - Detects devices offline for more than X seconds
 * - Sends FCM wake-up notifications to devices with valid FCM tokens
 * - Tracks wake-up attempts to avoid spamming
 * - Runs periodically via cron
 */

import { config } from "dotenv";
import mongoose from "mongoose";
import cron from "node-cron";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Device from "../models/Device.js";
import { sendWakeUpNotification } from "../lib/fcm/send.js";

// Get directory path for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from parent directory
config({ path: join(__dirname, "..", ".env.local") });
config({ path: join(__dirname, "..", ".env") });

const MONGO_URI = process.env.MONGODB_URI;

// Configuration from environment
const WAKE_UP_INTERVAL = process.env.FCM_WAKE_UP_CRON || "*/2 * * * * *"; // Every 2 minutes default
const OFFLINE_THRESHOLD_SECONDS = parseInt(process.env.FCM_WAKE_UP_OFFLINE_THRESHOLD || "120"); // 2 minutes default
const MAX_WAKE_UP_ATTEMPTS = parseInt(process.env.FCM_WAKE_UP_MAX_ATTEMPTS || "3"); // Max attempts per cycle
const WAKE_UP_COOLDOWN_MINUTES = parseInt(process.env.FCM_WAKE_UP_COOLDOWN || "5"); // Cooldown between attempts

// Track wake-up attempts to avoid spamming
const wakeUpAttempts = new Map(); // deviceId -> { count, lastAttempt }

/**
 * Find devices that are offline but have FCM tokens
 */
async function findOfflineDevices() {
  const offlineThreshold = new Date(Date.now() - OFFLINE_THRESHOLD_SECONDS * 1000);
  const offlineTimeout = new Date(Date.now() - 60 * 1000); // 60 seconds for status check

  const offlineDevices = await Device.find({
    isActive: true,
    status: 'offline',
    lastHeartbeat: { $lt: offlineThreshold },
    fcmToken: { $ne: null, $ne: "" } // Has FCM token
  });

  // Also check devices that haven't sent heartbeat recently but aren't marked offline yet
  const staleDevices = await Device.find({
    isActive: true,
    lastHeartbeat: { $lt: offlineThreshold },
    fcmToken: { $ne: null, $ne: "" }
  });

  // Combine and deduplicate
  const allDevices = [...offlineDevices, ...staleDevices];
  const uniqueDevices = Array.from(
    new Map(allDevices.map(d => [d.deviceId, d])).values()
  );

  return uniqueDevices;
}

/**
 * Check if a device can be woken up (respecting cooldown and attempt limits)
 */
function canWakeUp(device) {
  const now = Date.now();
  const attempts = wakeUpAttempts.get(device.deviceId);

  if (!attempts) {
    return true; // Never attempted, can wake up
  }

  const timeSinceLastAttempt = (now - attempts.lastAttempt) / 1000 / 60; // in minutes

  // Check cooldown period
  if (timeSinceLastAttempt < WAKE_UP_COOLDOWN_MINUTES) {
    return false; // Still in cooldown
  }

  // Reset attempts if cooldown has passed
  if (timeSinceLastAttempt >= WAKE_UP_COOLDOWN_MINUTES * 2) {
    wakeUpAttempts.set(device.deviceId, { count: 0, lastAttempt: 0 });
    return true;
  }

  // Check max attempts per cycle
  return attempts.count < MAX_WAKE_UP_ATTEMPTS;
}

/**
 * Record a wake-up attempt
 */
function recordWakeUpAttempt(deviceId) {
  const now = Date.now();
  const attempts = wakeUpAttempts.get(deviceId) || { count: 0, lastAttempt: 0 };

  wakeUpAttempts.set(deviceId, {
    count: attempts.count + 1,
    lastAttempt: now
  });
}

/**
 * Process offline devices and send wake-up notifications
 */
async function wakeUpOfflineDevices() {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🔄 FCM WAKE-UP SCAN  ${timestamp}`);
  console.log(`${'═'.repeat(60)}`);

  try {
    const offlineDevices = await findOfflineDevices();

    if (offlineDevices.length === 0) {
      console.log(`✅ All devices online - no wake-up needed`);
      console.log(`${'═'.repeat(60)}\n`);
      return;
    }

    console.log(`📱 Found ${offlineDevices.length} offline device(s) with FCM tokens`);
    console.log(`   Offline threshold: ${OFFLINE_THRESHOLD_SECONDS}s ago`);
    console.log(`   Cooldown period: ${WAKE_UP_COOLDOWN_MINUTES} minutes`);
    console.log(`   Max attempts: ${MAX_WAKE_UP_ATTEMPTS} per cycle`);
    console.log(`${'─'.repeat(60)}`);

    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;

    for (const device of offlineDevices) {
      const offlineDuration = Math.floor((Date.now() - new Date(device.lastHeartbeat).getTime()) / 1000);
      const offlineMinutes = Math.floor(offlineDuration / 60);

      // Check if we can wake up this device
      if (!canWakeUp(device)) {
        const attempts = wakeUpAttempts.get(device.deviceId);
        console.log(`⏭️  SKIP     ${device.deviceId} (${device.name || 'unnamed'})`);
        console.log(`    Reason: In cooldown or max attempts reached (${attempts?.count || 0} attempts)`);
        console.log(`    Offline for: ${offlineMinutes}m ${offlineDuration % 60}s ago`);
        skipCount++;
        continue;
      }

      console.log(`📡 WAKE-UP  ${device.deviceId} (${device.name || 'unnamed'})`);
      console.log(`    Offline for: ${offlineMinutes}m ${offlineDuration % 60}s ago`);
      console.log(`    FCM Token: ${device.fcmToken ? device.fcmToken.substring(0, 20) + '...' : 'none'}`);

      // Send FCM wake-up notification
      const success = await sendWakeUpNotification(device.deviceId, device.fcmToken);

      if (success) {
        recordWakeUpAttempt(device.deviceId);
        successCount++;
        console.log(`    ✅ Wake-up sent successfully`);
      } else {
        failCount++;
        console.log(`    ❌ Failed to send wake-up`);
      }

      console.log();
    }

    const elapsed = Date.now() - startTime;

    console.log(`${'─'.repeat(60)}`);
    console.log(`📊 SUMMARY  (${elapsed}ms)`);
    console.log(`   ✅ Success: ${successCount} device(s) woken`);
    console.log(`   ⏭️  Skipped: ${skipCount} device(s) (cooldown/limit)`);
    console.log(`   ❌ Failed:  ${failCount} device(s)`);
    console.log(`${'═'.repeat(60)}\n`);

  } catch (err) {
    console.error(`❌ WAKE-UP ERROR: ${err.message}`);
    console.error(`   ${err.stack}\n`);
  }
}

/**
 * Clean up old wake-up attempt records (run hourly)
 */
function cleanupOldAttempts() {
  const now = Date.now();
  const maxAge = WAKE_UP_COOLDOWN_MINUTES * 2 * 60 * 1000; // 2x cooldown period

  for (const [deviceId, attempts] of wakeUpAttempts.entries()) {
    if (now - attempts.lastAttempt > maxAge) {
      wakeUpAttempts.delete(deviceId);
    }
  }
}

/**
 * Initialize and start the wake-up service
 */
async function initialize() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🚀 FCM DEVICE WAKE-UP SERVICE`);
  console.log(`${'═'.repeat(60)}`);

  if (!MONGO_URI) {
    throw new Error("MONGODB_URI environment variable is not set");
  }

  await mongoose.connect(MONGO_URI);
  console.log(`✅ MongoDB connected`);

  // Log configuration
  console.log(`\n⚙️  Configuration:`);
  console.log(`   Wake-up interval:  ${WAKE_UP_INTERVAL}`);
  console.log(`   Offline threshold:  ${OFFLINE_THRESHOLD_SECONDS} seconds`);
  console.log(`   Max attempts:      ${MAX_WAKE_UP_ATTEMPTS} per cycle`);
  console.log(`   Cooldown period:   ${WAKE_UP_COOLDOWN_MINUTES} minutes`);

  // Schedule wake-up scans
  cron.schedule(WAKE_UP_INTERVAL, () => {
    wakeUpOfflineDevices();
  });

  // Schedule cleanup of old attempts (every hour)
  cron.schedule("0 * * * *", () => {
    cleanupOldAttempts();
  });

  console.log(`\n⏰  Scheduled tasks:`);
  console.log(`   - Wake-up scan:    Every ${WAKE_UP_INTERVAL.replace(/\*\//g, '')}`);
  console.log(`   - Cleanup:         Every hour`);
  console.log(`${'═'.repeat(60)}\n`);

  // Run initial scan
  console.log(`🔄 Running initial wake-up scan...\n`);
  await wakeUpOfflineDevices();
}

// Start the service
initialize().catch(error => {
  console.error("❌ Failed to initialize wake-up service:", error);
  process.exit(1);
});
