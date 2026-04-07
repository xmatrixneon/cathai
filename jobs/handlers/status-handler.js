// jobs/handlers/status-handler.js
import Numbers from '../../models/Numbers.js';
import Country from '../../models/Countires.js';
import Device from '../../models/Device.js';
import Message from '../../models/Message.js';

async function getIndiaId() {
  const country = await Country.findOne({ name: "India" });
  if (!country) {
    throw new Error("India country not found in database");
  }
  return country._id;
}

function normalizeIndianPhoneNumber(phoneNumber) {
  // Remove all non-digit characters
  const cleaned = phoneNumber.replace(/\D/g, '');

  // If starts with 91, remove it and keep last 10 digits
  if (cleaned.startsWith('91') && cleaned.length === 12) {
    return cleaned.substring(2);
  }

  // If already 10 digits, return as is
  if (cleaned.length === 10) {
    return cleaned;
  }

  // Otherwise return original
  return phoneNumber;
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

    console.log(`[Status] Found ${staleDevices.length} devices offline for ${AUTO_DELETE_HOURS}+ hours`);

    let deletedCount = 0;
    let errorCount = 0;

    for (const device of staleDevices) {
      try {
        await Message.deleteMany({ 'metadata.deviceId': device.deviceId });
        await Numbers.updateMany(
          { port: { $regex: `^${device.deviceId}-SIM` } },
          { $set: { active: false, signal: 0 } }
        );
        await Device.deleteOne({ _id: device._id });
        deletedCount++;
        console.log(`[Status] Deleted device ${device.deviceId}`);
      } catch (err) {
        errorCount++;
        console.error(`[Status] Failed to delete device ${device.deviceId}:`, err.message);
      }
    }

    return { deleted: deletedCount, errors: errorCount };
  } catch (err) {
    console.error('[Status] Cleanup error:', err.message);
    return { deleted: 0, errors: 1 };
  }
}

export async function handleStatusJob(data) {
  const startTime = Date.now();
  let processed = 0;
  let errors = 0;

  try {
    console.log('[Status] Starting device/number sync job');

    // Device status timeout (60 seconds)
    const offlineTimeout = new Date(Date.now() - 60 * 1000);

    const activeDevices = await Device.find({ isActive: true });
    const onlineDevices = activeDevices.filter(d => d.lastHeartbeat >= offlineTimeout);
    const offlineDevices = activeDevices.filter(d => d.lastHeartbeat < offlineTimeout);

    console.log(`[Status] Devices: ${activeDevices.length} total, ${onlineDevices.length} online, ${offlineDevices.length} offline`);

    // Track stats
    let syncedCount = 0;
    let deactivatedCount = 0;
    let statusChangedOnline = 0;
    let statusChangedOffline = 0;

    const indiaId = await getIndiaId();
    const allDeviceNumberPorts = new Set();
    const syncedPhoneNumbers = new Set();

    // First pass: Update device statuses and sync online device numbers
    for (const device of activeDevices) {
      const isOnline = device.lastHeartbeat >= offlineTimeout;
      const newStatus = isOnline ? 'online' : 'offline';

      if (device.status !== newStatus) {
        device.status = newStatus;
        await device.save();
        if (isOnline) {
          statusChangedOnline++;
        } else {
          statusChangedOffline++;
        }
      }

      // OFFLINE: Deactivate all numbers
      if (!isOnline) {
        const result = await Numbers.updateMany(
          { port: { $regex: `^${device.deviceId}-SIM` }, active: true },
          { $set: { active: false, signal: 0 } }
        );
        if (result.modifiedCount > 0) {
          deactivatedCount += result.modifiedCount;
        }
        continue;
      }

      // ONLINE: Sync active SIM numbers
      for (const sim of device.sims) {
        if (!sim.phoneNumber || !sim.isActive) continue;

        const port = `${device.deviceId}-SIM${sim.slot}`;
        allDeviceNumberPorts.add(port);

        let phoneNumber = sim.phoneNumber;
        let isIndian = false;

        // Check if Indian number
        if (phoneNumber.startsWith('91') || phoneNumber.length === 10) {
          phoneNumber = normalizeIndianPhoneNumber(phoneNumber);
          isIndian = true;
        }

        syncedPhoneNumbers.add(phoneNumber);

        // Upsert number
        await Numbers.findOneAndUpdate(
          { number: phoneNumber },
          {
            $set: {
              number: phoneNumber,
              port,
              active: true,
              locked: false,
              operator: sim.carrier || 'Unknown',
              signal: sim.signalStrength || 0,
              lastRotation: new Date(),
              country: isIndian ? indiaId : null,
            },
          },
          { upsert: true, new: true }
        );
        syncedCount++;
      }
    }

    // Second pass: Deactivate numbers not synced (stale cleanup)
    const stillActiveNumbers = await Numbers.find({ active: true });
    for (const num of stillActiveNumbers) {
      if (!syncedPhoneNumbers.has(num.number)) {
        await Numbers.findByIdAndUpdate(num._id, { $set: { active: false, signal: 0 } });
        deactivatedCount++;
      }
    }

    // Run stale device cleanup
    const cleanupResult = await cleanupStaleDevices();

    return {
      success: true,
      processed: activeDevices.length,
      errors,
      duration: Date.now() - startTime,
      details: {
        devicesTotal: activeDevices.length,
        devicesOnline: onlineDevices.length,
        devicesOffline: offlineDevices.length,
        statusChangedOnline,
        statusChangedOffline,
        numbersSynced: syncedCount,
        numbersDeactivated: deactivatedCount,
        devicesDeleted: cleanupResult.deleted,
      },
    };
  } catch (error) {
    errors++;
    console.error('[Status] Error:', error.message);
    return {
      success: false,
      processed,
      errors,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}
