// jobs/handlers/status-handler.js
// Optimized 2026-10-26: read-heavy pass uses .lean() + field projection,
// all writes are batched into chunked bulkWrite({ordered:false}) /
// updateMany instead of per-device save() and per-SIM round-trips.
// Semantics (validation rules, FCM wake-ups, counters, logs, return shape)
// are preserved from the previous implementation.
import mongoose from 'mongoose';
import Numbers from '../../models/Numbers.js';
import Country from '../../models/Countires.js';
import Device from '../../models/Device.js';
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

// Flush bulk ops in chunks of 1000 (MongoDB max batch), unordered for speed
async function flushBulk(Model, ops) {
  for (let i = 0; i < ops.length; i += 1000) {
    await Model.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
  }
}

export async function handleStatusJob(data) {
  const startTime = Date.now();
  let errors = 0;

  try {
    const timestamp = new Date().toISOString();

    // 60 second timeout to reduce device status flip-flopping
    const offlineTimeout = new Date(Date.now() - 60 * 1000);

    // Lean POJOs + projection: avoids hydrating ~14k full Mongoose docs
    const activeDevices = await Device.find({ isActive: true })
      .select('deviceId name status fcmToken lastHeartbeat sims.phoneNumber sims.isActive sims.slot sims.carrier sims.signalStrength sims.iccid sims.imsi')
      .lean();
    const onlineDevices = activeDevices.filter(d => d.lastHeartbeat >= offlineTimeout);
    const offlineDevices = activeDevices.filter(d => d.lastHeartbeat < offlineTimeout);

    const totalNumbersBefore = await Numbers.countDocuments();
    const activeNumbersBefore = await Numbers.countDocuments({ active: true });

    const indiaId = await getIndiaId();
    const allDeviceNumberPorts = new Set();
    const syncedPhoneNumbers = new Set();
    const validSims = [];          // { port, numberValue, sim } for online devices
    const offlineDeactivationOps = []; // updateOne per offline device (regex semantics kept)
    const deviceOps = [];          // status flips + FCM bookkeeping
    const wakeups = [];            // FCM wake-ups for just-offline devices
    let syncedCount = 0;
    let deactivatedCount = 0;
    let numberChangedCount = 0;
    let statusChangedOnline = 0;
    let statusChangedOffline = 0;

    // First pass: classify devices and collect all writes
    for (const device of activeDevices) {
      const isOnline = device.lastHeartbeat >= offlineTimeout;
      const newStatus = isOnline ? 'online' : 'offline';

      if (device.status !== newStatus) {
        deviceOps.push({
          updateOne: {
            filter: { _id: device._id },
            update: { $set: { status: newStatus } },
          },
        });
        if (isOnline) {
          statusChangedOnline++;
          console.log(`[Status] Device ${device.deviceId} came online`);
        } else {
          statusChangedOffline++;

          // Queue immediate wake-up for devices that just went offline
          // (fired in parallel chunks after the classification pass)
          if (device.fcmToken) {
            wakeups.push({ _id: device._id, deviceId: device.deviceId, fcmToken: device.fcmToken });
          }
        }
      }

      // OFFLINE DEVICES: Deactivate all their numbers immediately
      if (!isOnline) {
        offlineDeactivationOps.push({
          updateOne: {
            filter: { port: { $regex: `^${device.deviceId}-SIM` }, active: true },
            update: { $set: { active: false, signal: 0 } },
          },
        });
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
            continue;
          }

          // Convert to number for storage
          const numberValue = parseInt(finalNumber);
          syncedPhoneNumbers.add(numberValue);
          validSims.push({ port, numberValue, sim, isOnline });
        }
      }
    }

    // Fire FCM wake-ups for just-offline devices in parallel chunks
    if (wakeups.length > 0) {
      initializeFirebase();
      for (let i = 0; i < wakeups.length; i += 50) {
        await Promise.allSettled(wakeups.slice(i, i + 50).map(async (w) => {
          try {
            const result = await sendWakeUpNotification(w.deviceId, w.fcmToken);
            if (result.success) {
              deviceOps.push({
                updateOne: {
                  filter: { _id: w._id },
                  update: { $set: { lastWakeupAttempt: new Date() } },
                },
              });
            } else if (result.isStaleToken) {
              // Remove stale FCM token
              deviceOps.push({
                updateOne: {
                  filter: { deviceId: w.deviceId },
                  update: { $unset: { fcmToken: '', fcmTokenUpdatedAt: '' } },
                },
              });
            }
          } catch (err) {
            // Wake-up failures are non-fatal, same as before
          }
        }));
      }
    }

    // Flush device status flips + FCM bookkeeping in bulk
    await flushBulk(Device, deviceOps);

    // Deactivate numbers of all offline devices (regex per device kept, batched)
    for (let i = 0; i < offlineDeactivationOps.length; i += 1000) {
      const chunk = offlineDeactivationOps.slice(i, i + 1000);
      const res = await Numbers.bulkWrite(chunk, { ordered: false });
      deactivatedCount += res.modifiedCount ?? res.result?.nModified ?? 0;
    }

    // Batch detection of old numbers on synced ports (was: find+updateMany per SIM)
    const portList = [...allDeviceNumberPorts];
    const keepByPort = new Map();
    for (const vs of validSims) {
      keepByPort.set(vs.port, vs.numberValue);
    }
    const staleOnPortIds = [];
    if (portList.length > 0) {
      const portDocs = await Numbers.find({ port: { $in: portList } })
        .select('port number')
        .lean();
      for (const doc of portDocs) {
        const keep = keepByPort.get(doc.port);
        if (keep !== undefined && doc.number !== keep) {
          staleOnPortIds.push(doc._id);
        }
      }
      numberChangedCount += staleOnPortIds.length;
      if (staleOnPortIds.length > 0) {
        // Deactivate ALL old numbers on these ports (including inactive ones)
        await Numbers.updateMany(
          { _id: { $in: staleOnPortIds } },
          { $set: { active: false, signal: 0 } }
        );
      }
    }

    // Upsert all valid SIMs in bulk (was: findOneAndUpdate per SIM)
    const numberUpsertOps = validSims.map(({ port, numberValue, sim, isOnline }) => ({
      updateOne: {
        filter: { number: numberValue },
        update: {
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
        upsert: true,
      },
    }));
    await flushBulk(Numbers, numberUpsertOps);
    syncedCount = validSims.length;

    // Cleanup stale ports (only deactivate if number was NOT synced in this run)
    const staleNumbers = await Numbers.find({
      port: { $regex: /^.*-SIM[0-9]+$/ },
      active: true
    }).select('port number').lean();

    const staleIds = [];
    for (const num of staleNumbers) {
      if (!allDeviceNumberPorts.has(num.port) && !syncedPhoneNumbers.has(num.number)) {
        staleIds.push(num._id);
      }
    }
    if (staleIds.length > 0) {
      await Numbers.updateMany(
        { _id: { $in: staleIds } },
        { $set: { active: false, signal: 0 } }
      );
      deactivatedCount += staleIds.length;
    }

    const totalNumbersAfter = await Numbers.countDocuments();
    const activeNumbersAfter = await Numbers.countDocuments({ active: true });
    const elapsed = Date.now() - startTime;

    console.log(`[Status] Sync complete (${elapsed}ms): ${syncedCount} synced, ${deactivatedCount} deactivated, ${numberChangedCount} SIM swaps, +${statusChangedOnline} online, -${statusChangedOffline} offline`);

    // Update CronStatus for dashboard display
    try {
      await CronStatus.findOneAndUpdate(
        { name: 'syncStatus' },
        { lastRun: new Date() },
        { upsert: true }
      );
    } catch (cronErr) {
      console.error('[Sync] Failed to update CronStatus:', cronErr.message);
    }

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
