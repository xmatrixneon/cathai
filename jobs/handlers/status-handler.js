// jobs/handlers/status-handler.js
import mongoose from 'mongoose';
import Numbers from '../../models/Numbers.js';
import Country from '../../models/Countires.js';
import Device from '../../models/Device.js';
import Message from '../../models/Message.js';
import CronStatus from '../../models/Cron.js';
import { sendWakeUpNotification } from '../../lib/fcm/send.js';
import { initializeFirebase } from '../../lib/fcm/index.js';

async function getIndiaId() {
  const country = await Country.findOne({ name: "India" });
  if (!country) {
    throw new Error("India country not found in database");
  }
  // Ensure we return an ObjectId, not a string
  return country._id instanceof mongoose.Types.ObjectId
    ? country._id
    : new mongoose.Types.ObjectId(country._id.toString());
}

async function cleanupStaleDevices() {
  const AUTO_DELETE_ENABLED = process.env.DEVICE_AUTO_DELETE_ENABLED !== 'false';
  const AUTO_DELETE_HOURS = parseInt(process.env.DEVICE_AUTO_DELETE_HOURS || '24');

  if (!AUTO_DELETE_ENABLED) {
    return { deleted: 0, errors: 0 };
  }

  const cutoffTime = new Date(Date.now() - AUTO_DELETE_HOURS * 60 * 60 * 1000);

  try {
    const staleDevices = await Device.find({
      lastHeartbeat: { $lt: cutoffTime },
      isActive: true
    });

    if (staleDevices.length === 0) {
      return { deleted: 0, errors: 0 };
    }

    console.log(`\n${'─'.repeat(55)}`);
    console.log(`🧹 CLEANUP: Found ${staleDevices.length} device(s) offline for ${AUTO_DELETE_HOURS}+ hours`);
    console.log(`${'─'.repeat(55)}`);

    let deletedCount = 0;
    let errorCount = 0;

    for (const device of staleDevices) {
      try {
        // Delete associated messages
        const messagesDeleted = await Message.deleteMany({ 'metadata.deviceId': device.deviceId });

        // Deactivate all numbers from this device
        const numbersDeactivated = await Numbers.updateMany(
          { port: { $regex: `^${device.deviceId}-SIM` } },
          { $set: { active: false, signal: 0 } }
        );

        // Delete the device
        await Device.deleteOne({ _id: device._id });

        deletedCount++;
        // console.log(`🗑️ DELETED  ${device.deviceId} (${device.name || 'unnamed'})`);
        // console.log(`   Messages deleted: ${messagesDeleted.deletedCount}, Numbers deactivated: ${numbersDeactivated.modifiedCount}`);
      } catch (err) {
        errorCount++;
        console.error(`❌ Failed to delete device ${device.deviceId}: ${err.message}`);
      }
    }

    console.log(`${'─'.repeat(55)}`);
    console.log(`✅ CLEANUP DONE: Deleted ${deletedCount} device(s)${errorCount > 0 ? `, ${errorCount} error(s)` : ''}`);
    console.log(`${'─'.repeat(55)}`);

    return { deleted: deletedCount, errors: errorCount };
  } catch (err) {
    console.error(`❌ CLEANUP ERROR: ${err.message}`);
    return { deleted: 0, errors: 1 };
  }
}

export async function handleStatusJob(data) {
  const startTime = Date.now();
  let errors = 0;

  try {
    const timestamp = new Date().toISOString();

    // 60 second timeout to reduce device status flip-flopping
    const offlineTimeout = new Date(Date.now() - 60 * 1000);

    const activeDevices = await Device.find({ isActive: true });
    const onlineDevices = activeDevices.filter(d => d.lastHeartbeat >= offlineTimeout);
    const offlineDevices = activeDevices.filter(d => d.lastHeartbeat < offlineTimeout);

    const totalNumbersBefore = await Numbers.countDocuments();
    const activeNumbersBefore = await Numbers.countDocuments({ active: true });

    console.log(`\n${'─'.repeat(55)}`);
    console.log(`🔄 SYNC  ${timestamp}`);
    console.log(`${'─'.repeat(55)}`);
    console.log(`📱 Devices   Total: ${activeDevices.length}  🟢 Online: ${onlineDevices.length}  🔴 Offline: ${offlineDevices.length}`);
    console.log(`📋 Numbers   Total: ${totalNumbersBefore}  ✅ Active: ${activeNumbersBefore}  ❌ Inactive: ${totalNumbersBefore - activeNumbersBefore}`);
    console.log(`${'─'.repeat(55)}`);

    const indiaId = await getIndiaId();
    const allDeviceNumberPorts = new Set();
    const syncedPhoneNumbers = new Set();
    let syncedCount = 0;
    let deactivatedCount = 0;
    let numberChangedCount = 0;
    let statusChangedOnline = 0;
    let statusChangedOffline = 0;

    // First pass: Sync all devices and track their numbers
    for (const device of activeDevices) {
      const isOnline = device.lastHeartbeat >= offlineTimeout;
      const newStatus = isOnline ? 'online' : 'offline';

      if (device.status !== newStatus) {
        device.status = newStatus;
        await device.save();
        if (isOnline) {
          statusChangedOnline++;
          // console.log(`🟢 ONLINE   ${device.deviceId} (${device.name || 'unnamed'})`);
        } else {
          statusChangedOffline++;
          // console.log(`🔴 OFFLINE  ${device.deviceId} (${device.name || 'unnamed'})`);

          // Trigger immediate wake-up for devices that just went offline
          if (device.fcmToken) {
            initializeFirebase();
            try {
              const result = await sendWakeUpNotification(device.deviceId, device.fcmToken);
              if (result.success) {
                await Device.updateOne(
                  { _id: device._id },
                  { $set: { lastWakeupAttempt: new Date() } }
                );
                // console.log(`📡 WAKE-UP  Sent to ${device.deviceId}`);
              } else if (result.isStaleToken) {
                // Remove stale FCM token
                await Device.updateOne(
                  { deviceId: device.deviceId },
                  { $unset: { fcmToken: '', fcmTokenUpdatedAt: '' } }
                );
                // console.log(`⚠️  Stale FCM token removed for ${device.deviceId}`);
              }
            } catch (err) {
              // console.warn(`⚠️  Wake-up failed for ${device.deviceId}:`, err.message);
            }
          }
        }
      }

      // OFFLINE DEVICES: Deactivate all their numbers immediately
      if (!isOnline) {
        const result = await Numbers.updateMany(
          { port: { $regex: `^${device.deviceId}-SIM` }, active: true },
          { $set: { active: false, signal: 0 } }
        );
        if (result.modifiedCount > 0) {
          deactivatedCount += result.modifiedCount;
          // console.log(`🔌 DEACTIVATED ${result.modifiedCount} numbers from offline device ${device.deviceId}`);
        }
        continue;
      }

      for (const sim of device.sims) {
        if (sim.phoneNumber && sim.isActive) {
          const port = `${device.deviceId}-SIM${sim.slot}`;
          allDeviceNumberPorts.add(port);

          let phoneNumber = String(sim.phoneNumber).replace(/\D/g, '');
          const originalInput = String(sim.phoneNumber);

          // Validate and process phone number
          const isValidIndianMobile = (num) => /^[6-9]\d{9}$/.test(num);
          let invalidReason = null;
          let finalNumber = phoneNumber;

          // Case 1: Too short (< 10 digits)
          if (phoneNumber.length < 10) {
            invalidReason = `Too short (${phoneNumber.length} digits, need 10)`;
          }
          // Case 2: Remove 91 country code for Indian numbers
          else if (phoneNumber.length > 10 && phoneNumber.startsWith("91")) {
            let extracted = phoneNumber.substring(2, 12);

            // If invalid, try last 10 digits as fallback
            if (!isValidIndianMobile(extracted)) {
              let fallback = phoneNumber.substring(phoneNumber.length - 10);
              if (isValidIndianMobile(fallback)) {
                extracted = fallback;
              } else {
                invalidReason = `Invalid Indian format (after removing 91: "${extracted}", fallback: "${fallback}")`;
              }
            }

            if (!invalidReason) {
              finalNumber = extracted;
            }
          }
          // Case 3: Exactly 10 digits but invalid format
          else if (phoneNumber.length === 10) {
            if (!isValidIndianMobile(phoneNumber)) {
              invalidReason = `Invalid Indian format (must start with 6-9)`;
            }
          }
          // Case 4: Too long without 91 prefix
          else {
            invalidReason = `Too long (${phoneNumber.length} digits, expected 10)`;
          }

          // Final validation
          if (invalidReason || !isValidIndianMobile(finalNumber)) {
            // console.log(`⚠️  INVALID  ${device.deviceId} SIM${sim.slot} → "${originalInput}"`);
            // console.log(`   Reason: ${invalidReason || 'Unknown error'}`);
            // if (finalNumber !== phoneNumber) {
            //   console.log(`   Processed: "${phoneNumber}" → "${finalNumber}"`);
            // }
            continue;
          }

          // Convert to number for storage
          const numberValue = parseInt(finalNumber);
          syncedPhoneNumbers.add(numberValue);

          // Deactivate ALL old numbers on this port (including inactive ones)
          // This prevents duplicates when number format changes (e.g., with/without 91 prefix)
          const oldNumbers = await Numbers.find({ port, number: { $ne: numberValue } });
          if (oldNumbers.length > 0) {
            await Numbers.updateMany(
              { port, number: { $ne: numberValue } },
              { $set: { active: false, signal: 0 } }
            );
            oldNumbers.forEach(old => {
              const wasActive = old.active ? ' (was active)' : ' (was inactive)';
              // console.log(`🔄 CLEANUP  ${old.number}${wasActive} → ${numberValue}  (${port})`);
            });
            numberChangedCount += oldNumbers.length;
          }

          await Numbers.findOneAndUpdate(
            { number: numberValue },
            {
              $set: {
                countryid: indiaId,
                port,
                operator: sim.carrier || null,
                signal: isOnline ? (sim.signalStrength || 0) : 0,
                active: isOnline,
                lastRotation: new Date(),
                locked: false,
                iccid: sim.iccid || null,
                imsi: sim.imsi || null
              }
            },
            {
              upsert: true,
              new: true
            }
          );
          syncedCount++;
        }
      }
    }

    // Cleanup stale ports (only deactivate if number was NOT synced in this run)
    const staleNumbers = await Numbers.find({
      port: { $regex: /^.*-SIM[0-9]+$/ },
      active: true
    });

    for (const num of staleNumbers) {
      // Only deactivate if port is stale AND number wasn't synced
      if (!allDeviceNumberPorts.has(num.port) && !syncedPhoneNumbers.has(num.number)) {
        await Numbers.findByIdAndUpdate(num._id, {
          $set: { active: false, signal: 0 }
        });
        deactivatedCount++;
        // console.log(`🗑️  STALE    ${num.number}  (${num.port})`);
      }
    }

    const totalNumbersAfter = await Numbers.countDocuments();
    const activeNumbersAfter = await Numbers.countDocuments({ active: true });
    const elapsed = Date.now() - startTime;

    console.log(`${'─'.repeat(55)}`);
    console.log(`✅ DONE  (${elapsed}ms)`);
    console.log(`   Synced:       ${syncedCount} numbers`);
    console.log(`   Deactivated:  ${deactivatedCount} numbers`);
    if (numberChangedCount > 0)
      console.log(`   SIM swaps:    ${numberChangedCount} numbers replaced`);
    if (statusChangedOnline > 0 || statusChangedOffline > 0)
      console.log(`   Status chg:   +${statusChangedOnline} online  -${statusChangedOffline} offline`);
    console.log(`   Numbers now:  Total: ${totalNumbersAfter}  ✅ Active: ${activeNumbersAfter}  ❌ Inactive: ${totalNumbersAfter - activeNumbersAfter}`);
    console.log(`${'─'.repeat(55)}\n`);

    // Update CronStatus for dashboard display
    try {
      await CronStatus.findOneAndUpdate(
        { name: 'syncStatus' },
        { lastRun: new Date() },
        { upsert: true }
      );
      // console.log('[Sync] CronStatus updated');
    } catch (cronErr) {
      console.error('[Sync] Failed to update CronStatus:', cronErr.message);
    }

    // Run cleanup of stale devices after sync
    const cleanupResult = await cleanupStaleDevices();

    return {
      success: true,
      processed: activeDevices.length,
      errors,
      duration: elapsed,
      details: {
        devicesTotal: activeDevices.length,
        devicesOnline: onlineDevices.length,
        devicesOffline: offlineDevices.length,
        statusChangedOnline,
        statusChangedOffline,
        numbersSynced: syncedCount,
        numbersDeactivated: deactivatedCount,
        numberChanged: numberChangedCount,
        numbersBefore: totalNumbersBefore,
        numbersAfter: totalNumbersAfter,
        activeNumbersBefore,
        activeNumbersAfter,
        devicesDeleted: cleanupResult.deleted,
      },
    };
  } catch (error) {
    errors++;
    console.error(`\n❌ SYNC ERROR  ${new Date().toISOString()}`);
    console.error(`   ${error.message}\n`);
    return {
      success: false,
      processed: 0,
      errors,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}
