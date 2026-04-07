// jobs/utils/job-logger.js
export async function withJobLogging(job, fn) {
  const startTime = Date.now();
  const jobId = job.id;
  const queueName = job.queueName;
  const jobType = job.data.type || 'unknown';

  console.log(`[${queueName}] Starting job ${jobId} (${jobType})`);

  try {
    const result = await fn();
    const duration = Date.now() - startTime;

    console.log(`[${queueName}] Job ${jobId} completed in ${duration}ms`, {
      processed: result.processed,
      errors: result.errors,
      success: result.success,
    });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[${queueName}] Job ${jobId} failed after ${duration}ms:`, error.message);
    throw error;
  }
}

export function logJobStart(queueName, jobId, data) {
  console.log(`[${queueName}] Job ${jobId} started`, {
    type: data.type,
    runId: data.runId,
  });
}

export function logJobComplete(queueName, jobId, result, duration) {
  console.log(`[${queueName}] Job ${jobId} completed in ${duration}ms`, {
    success: result.success,
    processed: result.processed,
    errors: result.errors,
  });
}

export function logJobError(queueName, jobId, error, duration) {
  console.error(`[${queueName}] Job ${jobId} failed after ${duration}ms:`, {
    error: error.message,
    stack: error.stack,
  });
}
