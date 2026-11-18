#!/usr/bin/env node
/**
 * One-time / manual cleanup: delete devices offline longer than a threshold.
 *
 * For each deleted device:
 *   - deletes its messages (normally already purged by the 12h retention worker)
 *   - deactivates its numbers (active: false, signal: 0) — number docs are kept
 *     so quality history survives if the SIM returns on another device
 *   - deletes the device document
 *
 * Usage:
 *   node script/delete-stale-devices.mjs [--hours 720] [--before ISO_DATE] [--dry-run] [--batch 500]
 *
 *   --hours   offline hours before deletion (default: DEVICE_AUTO_DELETE_HOURS env or 720 = 30 days)
 *   --before  explicit cutoff ISO date (overrides --hours; use to pin to a backup's cutoff)
 *   --dry-run report what would be deleted without changing anything
 *
 * Example:
 *   node script/delete-stale-devices.mjs --dry-run
 *   node script/delete-stale-devices.mjs --before 2026-10-19T05:45:00Z
 */

import mongoose from 'mongoose';
import 'dotenv/config';
import Device from '../models/Device.js';
import Message from '../models/Message.js';
import Numbers from '../models/Numbers.js';

function parseArgs() {
  const args = { hours: null, before: null, dryRun: false, batch: 500 };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--hours') args.hours = parseInt(argv[++i], 10);
    else if (argv[i] === '--before') args.before = argv[++i];
    else if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--batch') args.batch = parseInt(argv[++i], 10);
  }
  return args;
}

async function run() {
  const args = parseArgs();

  let cutoff;
  if (args.before) {
    cutoff = new Date(args.before);
  } else {
    const hours = args.hours ?? parseInt(process.env.DEVICE_AUTO_DELETE_HOURS || '720', 10);
    cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  }
  if (isNaN(cutoff.getTime())) {
    console.error('Invalid cutoff date');
    process.exit(1);
  }

  console.log(`🧹 Stale device cleanup — cutoff: ${cutoff.toISOString()} (offline > ${cutoff.toISOString()} gets deleted)`);
  if (args.dryRun) console.log('   DRY RUN — no changes will be made');

  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log('   Connected to MongoDB');

  const query = { lastHeartbeat: { $lt: cutoff } };

  const total = await Device.countDocuments(query);
  console.log(`   Devices matching: ${total}`);
  if (total === 0) {
    await mongoose.disconnect();
    return;
  }

  const deletedIds = new Set();
  let devicesDeleted = 0;
  let messagesDeleted = 0;
  let batches = 0;

  // Stream deviceIds in batches; delete messages + device docs per batch
  const cursor = Device.find(query).select('deviceId').lean().cursor();
  let buffer = [];
  const flushBatch = async () => {
    if (buffer.length === 0) return;
    const ids = buffer.map(d => d.deviceId);
    batches++;

    if (!args.dryRun) {
      const msgRes = await Message.deleteMany({ 'metadata.deviceId': { $in: ids } });
      messagesDeleted += msgRes.deletedCount || 0;
      await Device.deleteMany({ deviceId: { $in: ids } });
    }
    ids.forEach(id => deletedIds.add(id));
    devicesDeleted += ids.length;
    buffer = [];

    if (batches % 10 === 0 || devicesDeleted >= total) {
      console.log(`   Progress: ${devicesDeleted}/${total} devices processed...`);
    }
  };

  for await (const doc of cursor) {
    buffer.push(doc);
    if (buffer.length >= args.batch) await flushBatch();
  }
  await flushBatch();

  console.log(`   Devices ${args.dryRun ? 'matched' : 'deleted'}: ${devicesDeleted}, messages deleted: ${messagesDeleted}`);

  // Deactivate numbers whose port belongs to a deleted device ({deviceId}-SIM{slot}).
  // Scan the numbers collection once and match port prefixes in memory.
  const numberCursor = Numbers.find({})
    .select('port active signal')
    .lean()
    .cursor();
  const numberOps = [];
  let numbersScanned = 0;

  for await (const num of numberCursor) {
    numbersScanned++;
    if (!num.port) continue;
    const portDevice = num.port.split('-SIM')[0];
    if (!deletedIds.has(portDevice)) continue;
    if (num.active || (num.signal !== undefined && num.signal !== 0)) {
      numberOps.push({
        updateOne: {
          filter: { _id: num._id },
          update: { $set: { active: false, signal: 0 } },
        },
      });
    }
  }

  let numbersDeactivated = 0;
  if (!args.dryRun && numberOps.length > 0) {
    for (let i = 0; i < numberOps.length; i += 1000) {
      const res = await Numbers.bulkWrite(numberOps.slice(i, i + 1000), { ordered: false });
      numbersDeactivated += res.modifiedCount ?? 0;
    }
  }

  console.log(`   Numbers scanned: ${numbersScanned}, deactivated: ${args.dryRun ? numberOps.length + ' (dry run)' : numbersDeactivated}`);
  console.log(`✅ Cleanup ${args.dryRun ? 'dry run' : 'complete'}: ${devicesDeleted} devices, ${messagesDeleted} messages, ${numbersDeactivated} numbers deactivated`);

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('❌ Cleanup failed:', err.message);
  process.exit(1);
});
