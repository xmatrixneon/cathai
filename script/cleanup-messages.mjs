import { config } from "dotenv";
import mongoose from "mongoose";
import cron from "node-cron";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Message from "../models/Message.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, "..", ".env.local") });
config({ path: join(__dirname, "..", ".env") });

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

// Configuration
const MESSAGE_CLEANUP_ENABLED = process.env.MESSAGE_CLEANUP_ENABLED !== 'false';
const MESSAGE_RETENTION_HOURS = parseInt(process.env.MESSAGE_RETENTION_HOURS || '12');
const MESSAGE_CLEANUP_DRY_RUN = process.env.MESSAGE_CLEANUP_DRY_RUN === 'true';
const MESSAGE_CLEANUP_BATCH_SIZE = parseInt(process.env.MESSAGE_CLEANUP_BATCH_SIZE || '1000');
const MESSAGE_CLEANUP_CRON = process.env.MESSAGE_CLEANUP_CRON || '0 */6 * * *';

/**
 * Delete old messages based on retention period
 */
async function cleanupOldMessages() {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🧹 MESSAGE CLEANUP  ${timestamp}`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`⚙️  Config:`);
  console.log(`   Retention:   ${MESSAGE_RETENTION_HOURS} hours`);
  console.log(`   Batch size:  ${MESSAGE_CLEANUP_BATCH_SIZE} messages`);
  console.log(`   Dry run:     ${MESSAGE_CLEANUP_DRY_RUN ? 'YES' : 'NO'}`);
  console.log(`${'═'.repeat(60)}`);

  try {
    // Calculate cutoff time (now - retention hours)
    const cutoffTime = new Date(Date.now() - MESSAGE_RETENTION_HOURS * 60 * 60 * 1000);

    // Step 1: Count old messages
    const oldCount = await Message.countDocuments({ time: { $lt: cutoffTime } });

    console.log(`📊 Found ${oldCount.toLocaleString()} messages older than ${MESSAGE_RETENTION_HOURS} hours`);
    console.log(`   Cutoff time: ${cutoffTime.toISOString()}`);

    if (oldCount === 0) {
      console.log(`✅ No old messages to delete`);
      console.log(`${'═'.repeat(60)}\n`);
      return;
    }

    if (MESSAGE_CLEANUP_DRY_RUN) {
      console.log(`🔍 [DRY RUN] Would delete ${oldCount.toLocaleString()} messages`);
      console.log(`${'═'.repeat(60)}\n`);
      return;
    }

    // Step 2: Delete in batches
    let totalDeleted = 0;
    let batchCount = 0;

    while (true) {
      // Find and delete one batch
      const batch = await Message.find({ time: { $lt: cutoffTime } })
        .limit(MESSAGE_CLEANUP_BATCH_SIZE)
        .lean();

      if (batch.length === 0) break;

      const idsToDelete = batch.map(m => m._id);
      const deleteResult = await Message.deleteMany({ _id: { $in: idsToDelete } });

      totalDeleted += deleteResult.deletedCount;
      batchCount++;

      console.log(`   Batch ${batchCount}: Deleted ${deleteResult.deletedCount.toLocaleString()} messages`);
    }

    const elapsed = Date.now() - startTime;

    console.log(`${'═'.repeat(60)}`);
    console.log(`✅ DONE  (${elapsed}ms)`);
    console.log(`   Total deleted: ${totalDeleted.toLocaleString()} messages`);
    console.log(`   Batches:       ${batchCount}`);
    console.log(`${'═'.repeat(60)}\n`);

  } catch (err) {
    console.error(`\n❌ CLEANUP ERROR  ${timestamp}`);
    console.error(`   ${err.message}\n`);
  }
}

async function initialize() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🚀 SMS GATEWAY — MESSAGE CLEANUP SERVICE`);
  console.log(`${'═'.repeat(60)}`);

  if (!MONGO_URI) {
    throw new Error("MONGODB_URI or MONGO_URI environment variable is not set.");
  }

  await mongoose.connect(MONGO_URI);
  console.log(`✅ MongoDB connected`);

  if (!MESSAGE_CLEANUP_ENABLED) {
    console.log(`⚠️  Message cleanup is DISABLED via MESSAGE_CLEANUP_ENABLED`);
    console.log(`${'═'.repeat(60)}\n`);
    return;
  }

  // Run on startup
  await cleanupOldMessages();

  // Schedule periodic cleanup
  cron.schedule(MESSAGE_CLEANUP_CRON, () => {
    cleanupOldMessages();
  });

  console.log(`⏱️  Scheduled: every 6 hours (${MESSAGE_CLEANUP_CRON})`);
  console.log(`${'═'.repeat(60)}\n`);
}

initialize().catch(error => {
  console.error("❌ Failed to initialize:", error);
  process.exit(1);
});
