#!/usr/bin/env node
/**
 * Test script for cleanup worker
 * Adds a test job to the maintenance-cleanup queue
 */

import { addCleanupJob } from '../lib/queues/maintenance-cleanup.js';
import { cleanupQueue } from '../lib/queues/maintenance-cleanup.js';

async function testCleanup() {
  console.log('=== Cleanup Worker Test ===\n');

  try {
    // Add a test job with dry run enabled
    console.log('1. Adding test job (dry run)...');
    const job = await addCleanupJob({
      type: 'scheduled',
      delay: 100,
    });

    console.log(`   Job ID: ${job.id}`);
    console.log(`   Run ID: ${job.data.runId}`);

    // Wait a bit for processing
    console.log('\n2. Waiting for processing (15 seconds)...');
    await new Promise(resolve => setTimeout(resolve, 15000));

    // Check job state
    console.log('\n3. Checking job state...');
    const state = await job.getState();
    console.log(`   State: ${state}`);

    if (state === 'completed') {
      try {
        const result = await job.returnvalue;
        if (result) {
          console.log(`   Processed: ${result.processed} messages`);
          console.log(`   Duration: ${result.duration}ms`);
          console.log(`   Dry run: ${result.details?.dryRun || 'N/A'}`);
        }
      } catch (e) {
        // Job was already removed from queue
        console.log(`   Job completed successfully (result already removed from queue)`);
      }
    } else if (state === 'failed') {
      const error = await job.failedReason;
      console.log(`   Failed: ${error}`);
    }

    // Check queue stats
    console.log('\n4. Queue stats:');
    const stats = await cleanupQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
    console.log(`   Waiting: ${stats.waiting || 0}`);
    console.log(`   Active: ${stats.active || 0}`);
    console.log(`   Completed: ${stats.completed || 0}`);
    console.log(`   Failed: ${stats.failed || 0}`);
    console.log(`   Delayed: ${stats.delayed || 0}`);

    console.log('\n✅ Test complete');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  } finally {
    // Close queue connection
    await cleanupQueue.close();
  }
}

testCleanup();
