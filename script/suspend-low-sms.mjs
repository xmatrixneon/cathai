import { config } from "dotenv";
import mongoose from "mongoose";
import cron from "node-cron";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Numbers from "../models/Numbers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, "..", ".env.local") });
config({ path: join(__dirname, "..", ".env") });

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

// Configuration
const SMS_AUTO_SUSPEND_ENABLED = process.env.SMS_AUTO_SUSPEND_ENABLED !== 'false';
const SMS_SUSPEND_ORDER_THRESHOLD = parseInt(process.env.SMS_SUSPEND_ORDER_THRESHOLD || '10');  // Minimum orders to check
const SMS_SUSPEND_WINDOW_HOURS = parseInt(process.env.SMS_SUSPEND_WINDOW_HOURS || '24');  // Time window for order counting
const SMS_SUSPEND_DRY_RUN = process.env.SMS_SUSPEND_DRY_RUN === 'true';
// Test mode: only process this specific number (if set)
const SMS_TEST_NUMBER = process.env.SMS_TEST_NUMBER ? parseInt(process.env.SMS_TEST_NUMBER) : null;

/**
 * Suspend numbers with failed orders (N+ orders, all with 0 SMS)
 */
async function suspendLowSmsNumbers() {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🔍 ORDER SUSPEND CHECK  ${timestamp}`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`⚙️  Config:`);
  console.log(`   Order threshold: ${SMS_SUSPEND_ORDER_THRESHOLD}+ orders`);
  console.log(`   Time window:     ${SMS_SUSPEND_WINDOW_HOURS} hours`);
  console.log(`   Condition:       ALL orders must have 0 SMS`);
  console.log(`   Dry run:         ${SMS_SUSPEND_DRY_RUN ? 'YES' : 'NO'}`);
  console.log(`${'═'.repeat(60)}`);

  try {
    const cutoffTime = new Date(Date.now() - SMS_SUSPEND_WINDOW_HOURS * 60 * 60 * 1000);

    // Step 1: Find numbers with N+ orders where ALL have 0 messages
    const aggregationPipeline = [
      {
        $match: {
          createdAt: { $gte: cutoffTime }
        }
      },
      {
        $group: {
          _id: "$number",
          totalOrders: { $sum: 1 },
          ordersWithMessages: {
            $sum: {
              $cond: [{ $gt: [{ $size: { $ifNull: ["$message", []] } }, 0] }, 1, 0]
            }
          },
          totalMessages: {
            $sum: {
              $size: { $ifNull: ["$message", []] }
            }
          }
        }
      },
      {
        $match: {
          totalOrders: { $gte: SMS_SUSPEND_ORDER_THRESHOLD },
          ordersWithMessages: 0  // ALL orders have 0 messages
        }
      }
    ];

    // Apply test number filter if specified
    if (SMS_TEST_NUMBER) {
      aggregationPipeline[0].$match.number = SMS_TEST_NUMBER;
      console.log(`🧪 TEST MODE: Only checking number ${SMS_TEST_NUMBER}`);
    }

    const numbersToSuspend = await mongoose.connection.db.collection('orders').aggregate(aggregationPipeline).toArray();

    let suspendedCount = 0;
    let skippedCount = 0;

    for (const item of numbersToSuspend) {
      const numberRecord = await Numbers.findOne({ number: item._id, active: true, suspended: false });

      if (!numberRecord) {
        skippedCount++;
        continue;
      }

      console.log(`⚠️  SUSPEND: ${item._id} → ${item.totalOrders} orders, 0 SMS (threshold: ${SMS_SUSPEND_ORDER_THRESHOLD} orders)`);

      if (!SMS_SUSPEND_DRY_RUN) {
        await Numbers.findByIdAndUpdate(numberRecord._id, {
          $set: {
            suspended: true,
            suspensionReason: 'low_sms',
            suspendedAt: new Date(),
            lastLowSmsCheck: new Date(),
            smsReceivedInWindow: item.totalMessages
          },
          $inc: {
            lowSmsSuspensionCount: 1
          }
        });
        suspendedCount++;
      } else {
        console.log(`   [DRY RUN] Would suspend ${item._id}`);
      }
    }

    // Step 2: Auto-recovery - check suspended numbers with reason "low_sms"
    const recoveryQuery = {
      active: true,
      suspended: true,
      suspensionReason: 'low_sms'
    };
    if (SMS_TEST_NUMBER) {
      recoveryQuery.number = SMS_TEST_NUMBER;
    }
    const lowSmsSuspended = await Numbers.find(recoveryQuery).lean();

    let recoveredCount = 0;

    for (const number of lowSmsSuspended) {
      // Get SMS count for this number in the time window
      const smsResult = await mongoose.connection.db.collection('orders').aggregate([
        {
          $match: {
            number: number.number,
            createdAt: { $gte: cutoffTime }
          }
        },
        {
          $group: {
            _id: "$number",
            totalMessages: {
              $sum: {
                $size: { $ifNull: ["$message", []] }
              }
            }
          }
        }
      ]).toArray();

      const smsCount = smsResult.length > 0 ? smsResult[0].totalMessages : 0;

      // Update check time
      await Numbers.findByIdAndUpdate(number._id, {
        $set: {
          lastLowSmsCheck: new Date(),
          smsReceivedInWindow: smsCount
        }
      });

      // Recover if ANY SMS received
      if (smsCount > 0) {
        console.log(`✅ RECOVER: ${number.number} → ${smsCount} SMS received`);

        if (!SMS_SUSPEND_DRY_RUN) {
          await Numbers.findByIdAndUpdate(number._id, {
            $set: {
              suspended: false,
              suspensionReason: 'none',
              suspendedAt: null
            }
          });
          recoveredCount++;
        } else {
          console.log(`   [DRY RUN] Would recover ${number.number}`);
        }
      }
    }

    const elapsed = Date.now() - startTime;

    console.log(`${'═'.repeat(60)}`);
    console.log(`✅ DONE  (${elapsed}ms)`);
    console.log(`   Checked:      ${numbersToSuspend.length} numbers meeting criteria`);
    console.log(`   Suspended:    ${suspendedCount} numbers`);
    console.log(`   Recovered:    ${recoveredCount} numbers`);
    console.log(`   Skipped:      ${skippedCount} numbers (already suspended or inactive)`);
    console.log(`${'═'.repeat(60)}\n`);

  } catch (err) {
    console.error(`\n❌ SUSPEND CHECK ERROR  ${timestamp}`);
    console.error(`   ${err.message}\n`);
  }
}

/**
 * Recover suspended numbers that have received SMS (runs every 5 minutes)
 */
async function recoverLowSmsNumbers() {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🔄 RECOVERY CHECK  ${timestamp}`);
  console.log(`${'═'.repeat(60)}`);

  try {
    const cutoffTime = new Date(Date.now() - SMS_SUSPEND_WINDOW_HOURS * 60 * 60 * 1000);

    // Check suspended numbers with reason "low_sms"
    const recoveryQuery = {
      active: true,
      suspended: true,
      suspensionReason: 'low_sms'
    };
    if (SMS_TEST_NUMBER) {
      recoveryQuery.number = SMS_TEST_NUMBER;
    }
    const lowSmsSuspended = await Numbers.find(recoveryQuery).lean();

    let recoveredCount = 0;
    let stillSuspendedCount = 0;

    for (const number of lowSmsSuspended) {
      // Get SMS count for this number in the time window
      const smsResult = await mongoose.connection.db.collection('orders').aggregate([
        {
          $match: {
            number: number.number,
            createdAt: { $gte: cutoffTime }
          }
        },
        {
          $group: {
            _id: "$number",
            totalMessages: {
              $sum: {
                $size: { $ifNull: ["$message", []] }
              }
            }
          }
        }
      ]).toArray();

      const smsCount = smsResult.length > 0 ? smsResult[0].totalMessages : 0;

      // Update check time
      await Numbers.findByIdAndUpdate(number._id, {
        $set: {
          lastLowSmsCheck: new Date(),
          smsReceivedInWindow: smsCount
        }
      });

      // Recover if ANY SMS received
      if (smsCount > 0) {
        console.log(`✅ RECOVER: ${number.number} → ${smsCount} SMS received`);

        await Numbers.findByIdAndUpdate(number._id, {
          $set: {
            suspended: false,
            suspensionReason: 'none',
            suspendedAt: null
          }
        });
        recoveredCount++;
      } else {
        stillSuspendedCount++;
      }
    }

    const elapsed = Date.now() - startTime;

    console.log(`${'═'.repeat(60)}`);
    console.log(`✅ DONE  (${elapsed}ms)`);
    console.log(`   Checked:      ${lowSmsSuspended.length} suspended numbers`);
    console.log(`   Recovered:    ${recoveredCount} numbers`);
    console.log(`   Still suspended: ${stillSuspendedCount} numbers`);
    console.log(`${'═'.repeat(60)}\n`);

  } catch (err) {
    console.error(`\n❌ RECOVERY CHECK ERROR  ${timestamp}`);
    console.error(`   ${err.message}\n`);
  }
}

async function initialize() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🚀 SMS GATEWAY — LOW SMS SUSPEND MONITOR`);
  console.log(`${'═'.repeat(60)}`);

  if (!MONGO_URI) {
    throw new Error("MONGODB_URI or MONGO_URI environment variable is not set.");
  }

  await mongoose.connect(MONGO_URI);
  console.log(`✅ MongoDB connected`);

  if (!SMS_AUTO_SUSPEND_ENABLED) {
    console.log(`⚠️  SMS auto-suspend is DISABLED via SMS_AUTO_SUSPEND_ENABLED`);
    console.log(`${'═'.repeat(60)}\n`);
    return;
  }

  // Run on startup
  await suspendLowSmsNumbers();
  await recoverLowSmsNumbers();

  // Schedule suspend check every 15 minutes
  cron.schedule("*/15 * * * *", () => {
    suspendLowSmsNumbers();
  });

  // Schedule recovery check every 5 minutes
  cron.schedule("*/5 * * * *", () => {
    recoverLowSmsNumbers();
  });

  console.log(`⏱️  Suspend check: every 15 minutes`);
  console.log(`⏱️  Recovery check: every 5 minutes`);
  console.log(`${'═'.repeat(60)}\n`);
}

initialize().catch(error => {
  console.error("❌ Failed to initialize:", error);
  process.exit(1);
});
