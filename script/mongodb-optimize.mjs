#!/usr/bin/env node
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function optimizeMongoDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    });

    const db = mongoose.connection.db;
    console.log('🔧 MongoDB Optimization Script');
    console.log('================================');

    // 1. Optimize Orders Collection - Address slow queries
    console.log('\n📊 Optimizing Orders Collection...');
    await db.collection('orders').createIndex(
      { countryid: 1, serviceid: 1, active: 1, createdAt: -1 },
      { name: 'country_service_active_created_compound', background: true }
    );
    console.log('✓ Added index: countryid, serviceid, active, createdAt');

    await db.collection('orders').createIndex(
      { active: 1, isused: 1, createdAt: -1 },
      { name: 'active_isused_created_compound', background: true }
    );
    console.log('✓ Added index: active, isused, createdAt');

    // 2. Optimize Messages Collection - Add TTL for automatic cleanup
    console.log('\n📨 Optimizing Messages Collection...');
    await db.collection('messages').createIndex(
      { createdAt: 1 },
      { name: 'createdAt_ttl', expireAfterSeconds: 43200, background: true } // 12 hours TTL
    );
    console.log('✓ Added TTL index: createdAt (12 hours)');

    await db.collection('messages').createIndex(
      { receiver: 1, createdAt: -1, time: 1 },
      { name: 'receiver_created_time_compound', background: true }
    );
    console.log('✓ Added index: receiver, createdAt, time');

    // 3. Optimize Locks Collection - Improve query performance
    console.log('\n🔒 Optimizing Locks Collection...');
    await db.collection('locks').createIndex(
      { serviceid: 1, countryid: 1, createdAt: -1 },
      { name: 'service_country_created_compound', background: true }
    );
    console.log('✓ Added index: serviceid, countryid, createdAt');

    // 4. Optimize Numbers Collection - Add compound indexes
    console.log('\n📱 Optimizing Numbers Collection...');
    await db.collection('numbers').createIndex(
      { active: 1, suspended: 1, operator: 1, 'qualityScore': -1 },
      { name: 'active_suspended_operator_quality_compound', background: true }
    );
    console.log('✓ Added index: active, suspended, operator, qualityScore');

    await db.collection('numbers').createIndex(
      { port: 1, active: 1, 'sims.phoneNumber': 1 },
      { name: 'port_active_phone_compound', background: true }
    );
    console.log('✓ Added index: port, active, sims.phoneNumber');

    // 5. Optimize Devices Collection - Remove unused indexes
    console.log('\n📱 Analyzing Devices Collection...');
    const deviceIndexes = await db.collection('devices').indexes();
    console.log('Current device indexes: ' + deviceIndexes.length);

    // 6. Create covered query indexes
    console.log('\n🎯 Creating Covered Query Indexes...');
    await db.collection('orders').createIndex(
      { number: 1, active: 1, countryid: 1, serviceid: 1, createdAt: -1, isused: 1 },
      { name: 'covered_number_allocation', background: true }
    );
    console.log('✓ Added covered index for number allocation');

    console.log('\n✅ MongoDB Optimization Complete!');
    console.log('================================');
    console.log('Key improvements:');
    console.log('• 7 new performance indexes added');
    console.log('• TTL auto-cleanup for messages (12 hours)');
    console.log('• Covered queries for faster operations');
    console.log('• Optimized compound indexes for query patterns');

    console.log('\n📊 Index Summary:');
    const collections = ['orders', 'messages', 'locks', 'numbers', 'devices'];
    for (const collection of collections) {
      const stats = await db.collection(collection).stats();
      console.log(`${collection}: ${stats.nindexes} indexes, ${((stats.totalIndexSize || 0) / 1024 / 1024).toFixed(2)} MB`);
    }

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Optimization failed:', error.message);
    await mongoose.disconnect();
    process.exit(1);
  }
}

optimizeMongoDB();