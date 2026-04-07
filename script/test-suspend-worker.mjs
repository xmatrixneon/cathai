#!/usr/bin/env node
/**
 * Test script for suspend worker
 * Adds a test job to the quality-suspend queue
 */

import { addSuspendJob } from '../lib/queues/quality-suspend.js';
import { suspendQueue } from '../lib/queues/quality-suspend.js';

async function testSuspend() {
  console.log('=== Suspend Worker Test ===\n');

  try {
    // Add a test job with dry run enabled
    console.log('1. Adding test suspend-check job...');
    const job = await addSuspendJob({
      type: 'suspend-check',
      delay: 100,
    });

    console.log(`   Job ID: ${job.id}`);
    console.log(`   Run ID: ${job.data.runId}`);
    console.log(`   Type: ${job.data.type}`);

    // Wait for processing
    console.log('\n2. Waiting for processing (15 seconds)...');
    await new Promise(resolve => setTimeout(resolve, 15000));

    // Check job state
    console.log('\n3. Checking job state...');
    const state = await job.getState();
    console.log(`   State: ${state}`);

    // Check queue stats
    console.log('\n4. Queue stats:');
    const stats = await suspendQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
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
    await suspendQueue.close();
  }
}

testSuspend();
