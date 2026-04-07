// jobs/handlers/cleanup-handler.js
import Message from '../../models/Message.js';

export async function handleCleanupJob(data) {
  const startTime = Date.now();
  let processed = 0;
  let errors = 0;

  try {
    const { retentionHours = 12, batchSize = 1000, dryRun = false } = data;
    const cutoffDate = new Date(Date.now() - retentionHours * 60 * 60 * 1000);

    console.log(`[Cleanup] Deleting messages older than ${cutoffDate.toISOString()} (dryRun=${dryRun})`);

    let hasMore = true;
    let totalDeleted = 0;

    while (hasMore) {
      const oldMessages = await Message.find({
        time: { $lt: cutoffDate }
      }).limit(batchSize);

      if (oldMessages.length === 0) {
        hasMore = false;
        break;
      }

      if (dryRun) {
        console.log(`[Cleanup] Would delete ${oldMessages.length} messages`);
        totalDeleted += oldMessages.length;
        processed = oldMessages.length;
        hasMore = false;
      } else {
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
    return {
      success: false,
      processed,
      errors,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}
