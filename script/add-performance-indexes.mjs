#!/usr/bin/env node
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function addPerformanceIndexes() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    });

    const db = mongoose.connection.db;
    console.log('🔍 Checking and adding performance indexes...');

    // Helper function to check if index exists
    async function ensureIndex(collectionName, indexSpec, options) {
      try {
        const collection = db.collection(collectionName);
        const existingIndexes = await collection.indexes();
        const existingIndex = existingIndexes.find(idx => {
          const keys = idx.key;
          return JSON.stringify(keys) === JSON.stringify(indexSpec);
        });

        if (existingIndex) {
          console.log(`✓ ${collectionName}: Index already exists - ${JSON.stringify(indexSpec)}`);
          return false;
        }

        await collection.createIndex(indexSpec, options);
        console.log(`✓ ${collectionName}: Index added - ${JSON.stringify(indexSpec)}`);
        return true;
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`✓ ${collectionName}: Index already exists - ${JSON.stringify(indexSpec)}`);
          return false;
        }
        throw error;
      }
    }

    // Messages collection - compound index for user messages
    console.log('\nChecking messages collection...');
    await ensureIndex('messages', { receiver: 1, createdAt: -1 },
      { name: 'receiver_createdAt_compound', background: true });

    // Orders collection - optimize for status checks and allocation
    console.log('\nChecking orders collection...');
    await ensureIndex('orders', { active: 1, countryid: 1, serviceid: 1 },
      { name: 'active_country_service_compound', background: true });
    await ensureIndex('orders', { active: 1, failureReason: 1, createdAt: -1 },
      { name: 'active_failure_created_compound', background: true });

    // Numbers collection - optimize for allocation queries
    console.log('\nChecking numbers collection...');
    await ensureIndex('numbers', { active: 1, suspended: 1, 'qualityScore': -1 },
      { name: 'active_suspended_quality_compound', background: true });

    // Devices collection - optimize for status queries
    console.log('\nChecking devices collection...');
    await ensureIndex('devices', { status: 1, lastHeartbeat: -1 },
      { name: 'status_heartbeat_compound', background: true });
    await ensureIndex('devices', { 'sims.phoneNumber': 1 },
      { name: 'sims_phonenumber_compound', background: true });

    console.log('\n✅ All performance indexes added successfully!');
    console.log('These indexes will improve query performance for common patterns.');
    console.log('Indexes were built in background mode - no production impact.');

    // Show existing indexes
    console.log('\n📊 Current index summary:');
    const collections = ['messages', 'orders', 'numbers', 'devices'];
    for (const collection of collections) {
      const indexes = await db.collection(collection).indexes();
      console.log(`${collection}: ${indexes.length} indexes`);
    }

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to add performance indexes:', error.message);
    await mongoose.disconnect();
    process.exit(1);
  }
}

addPerformanceIndexes();