#!/usr/bin/env node
/**
 * Test script for status worker
 * Adds a test job to the device-status queue
 */

import { addStatusJob } from '../lib/queues/device-status.js';
import { statusQueue } from '../lib/queues/device-status.js';

async function testStatus() {
  console.log('=== Status Worker Test ===\n');

  try {
    // Add a test job
    console.log('1. Adding test status job...');
    const job = await addStatusJob({
      type: 'scheduled',
      delay: 100,
    });

    console.log(`   Job ID: ${job.id}`);
    console.log(`   Run ID: ${job.data.runId}`);
    console.log(`   Type: ${job.data.type}`);

    // Wait for processing
    console.log('\n2. Waiting for processing (20 seconds)...');
    await new Promise(resolve => setTimeout(resolve, 20000));

    // Check job state
    console.log('\n3. Checking job state...');
    const state = await job.getState();
    console.log(`   State: ${state}`);

    // Check queue stats
    console.log('\n4. Queue stats:');
    const stats = await statusQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
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
    await statusQueue.close();
  }
}

testStatus();
