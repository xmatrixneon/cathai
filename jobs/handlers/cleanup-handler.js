// jobs/handlers/cleanup-handler.js
import Message from '../../models/Message.js';

export async function handleCleanupJob(data) {
  const startTime = Date.now();
  let processed = 0;
  let errors = 0;

  try {
    const { retentionHours = 12, batchSize = 1000, dryRun = false } = data;
    const cutoffDate = new Date(Date.now() - retentionHours * 60 * 60 * 1000);

    console.log(`[Cleanup] Starting: Deleting messages older than ${cutoffDate.toISOString()} (dryRun=${dryRun})`);

    // Count messages first
    console.log(`[Cleanup] Counting messages...`);
    const oldCount = await Message.countDocuments({ time: { $lt: cutoffDate } });
    console.log(`[Cleanup] Found ${oldCount} messages to process`);

    if (oldCount === 0) {
      console.log(`[Cleanup] No messages to delete, returning success`);
      return {
        success: true,
        processed: 0,
        errors: 0,
        duration: Date.now() - startTime,
        details: {
          retentionHours,
          cutoffDate: cutoffDate.toISOString(),
          totalDeleted: 0,
          dryRun,
        },
      };
    }

    let totalDeleted = 0;

    if (dryRun) {
      console.log(`[Cleanup] Would delete ${oldCount} messages`);
      totalDeleted = oldCount;
    } else {
      let hasMore = true;
      while (hasMore) {
        const oldMessages = await Message.find({
          time: { $lt: cutoffDate }
        }).limit(batchSize);

        if (oldMessages.length === 0) {
          hasMore = false;
          break;
        }

        const idsToDelete = oldMessages.map(m => m._id);
        const deleteResult = await Message.deleteMany({ _id: { $in: idsToDelete } });
        totalDeleted += deleteResult.deletedCount;
        processed += deleteResult.deletedCount;
        console.log(`[Cleanup] Deleted ${deleteResult.deletedCount} messages`);
      }
    }

    return {
      success: true,
      processed: totalDeleted,
      errors: 0,
      duration: Date.now() - startTime,
      details: {
        retentionHours,
        cutoffDate: cutoffDate.toISOString(),
        totalDeleted,
        dryRun,
      },
    };
  } catch (error) {
    errors++;
    console.error(`[Cleanup] Error:`, error);
    return {
      success: false,
      processed,
      errors,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}
