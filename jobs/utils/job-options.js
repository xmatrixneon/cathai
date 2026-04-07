// jobs/utils/job-options.js
import { getRedis } from '../../lib/queues/redis.js';

// Job options configuration for each queue type
export const jobOptions = {
  'sms-fetch': {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
  'device-status': {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: 50,
    removeOnFail: 250,
  },
  'device-keepalive': {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 3000,
    },
    removeOnComplete: 50,
    removeOnFail: 200,
  },
  'quality-suspend': {
    attempts: 2,
    backoff: {
      type: 'fixed',
      delay: 10000,
    },
    removeOnComplete: 20,
    removeOnFail: 100,
  },
  'maintenance-cleanup': {
    attempts: 1,
    backoff: {
      type: 'fixed',
      delay: 5000,
    },
    removeOnComplete: 10,
    removeOnFail: 50,
  },
};

// Get job options for a specific queue
export function getJobOptions(queueName) {
  return jobOptions[queueName] || {};
}

// Common queue connection options
export function getQueueOptions() {
  return {
    connection: getRedis(),
  };
}

// Worker concurrency configuration from env
export function getWorkerConcurrency(queueName, defaultConcurrency = 1) {
  const envVar = `BULLMQ_CONCURRENCY_${queueName.replace('-', '_').toUpperCase()}`;
  return parseInt(process.env[envVar] || String(defaultConcurrency), 10);
}

// Job intervals from env (milliseconds)
export function getJobInterval(queueName, defaultInterval) {
  const envVar = `BULLMQ_${queueName.replace('-', '_').toUpperCase()}_INTERVAL`;
  return parseInt(process.env[envVar] || String(defaultInterval), 10);
}
