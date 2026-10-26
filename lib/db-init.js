import mongoose from 'mongoose';
import Numbers from '../models/Numbers.js';
import Orders from '../models/Orders.js';
import Messages from '../models/Message.js';
import Countries from '../models/Countires.js';
import Device from '../models/Device.js';
import Lock from '../models/Lock.js';

/**
 * Database Schema Initialization
 * Ensures all indexes exist when application starts
 * This guarantees consistency between codebase and database
 */
export async function initializeDatabase() {
  try {
    console.log('🔧 Initializing database indexes...');

    // 1. Numbers Collection Indexes
    console.log('📊 Setting up Numbers indexes...');
    try {
      await Numbers.createIndexes();
      await Numbers.collection.createIndex(
        { active: 1, countryid: 1 },
        { name: 'active_countryid_compound', background: true }
      );
      await Numbers.collection.createIndex(
        { port: 1, active: 1, 'sims.phoneNumber': 1 },
        { name: 'port_active_phone_compound', background: true }
      );
      // Hot path for the PHP stubs API getNumber allocation (count+skip pick)
      await Numbers.collection.createIndex(
        { countryid: 1, active: 1, suspended: 1 },
        { name: 'country_active_suspended', background: true }
      );
      // Quality dashboard listing (filter active+suspended, sort by score)
      await Numbers.collection.createIndex(
        { active: 1, suspended: 1, qualityScore: -1 },
        { name: 'active_suspended_quality_compound', background: true }
      );
      console.log('✅ Numbers indexes configured');
    } catch (error) {
      if (!error.message.includes('already exists')) {
        console.error('Numbers indexes error:', error.message);
      }
    }

    // 2. Orders Collection Indexes
    console.log('📦 Setting up Orders indexes...');
    try {
      await Orders.createIndexes();
      // Retention: orders auto-delete after 15 days (rolling window).
      // Keeps the collection at ~3M docs instead of growing unbounded.
      await Orders.collection.createIndex(
        { createdAt: 1 },
        { name: 'ttl_createdAt_15d', expireAfterSeconds: 1296000, background: true }
      );
      // Hot path for the PHP stubs API allocation checks
      // (active-order / recent-usage / cooldown findOne lookups)
      await Orders.collection.createIndex(
        { number: 1, countryid: 1, serviceid: 1, isused: 1, active: 1, updatedAt: -1 },
        { name: 'number_country_service_used_active_updated', background: true }
      );
      // Active orders by country+service (fetch worker + overview queries)
      await Orders.collection.createIndex(
        { active: 1, countryid: 1, serviceid: 1 },
        { name: 'active_country_service_compound', background: true }
      );
      // Performance optimization for chart/overview queries
      await Orders.collection.createIndex(
        { createdAt: 1, isused: 1 },
        { name: 'created_isused_compound', background: true }
      );
      // Fast countDocuments({isused: true}) for dashboard totals
      await Orders.collection.createIndex(
        { isused: 1 },
        { name: 'isused_compound', background: true }
      );
      // Covered index for the 7-day chart aggregation (createdAt range +
      // number distinct + isused counts without fetching documents)
      await Orders.collection.createIndex(
        { createdAt: 1, number: 1, isused: 1 },
        { name: 'created_number_isused_covered', background: true }
      );
      console.log('✅ Orders indexes configured');
    } catch (error) {
      if (!error.message.includes('already exists')) {
        console.error('Orders indexes error:', error.message);
      }
    }

    // 3. Messages Collection Indexes (including TTL)
    console.log('📨 Setting up Messages indexes...');
    try {
      await Messages.createIndexes();
      await Messages.collection.createIndex(
        { createdAt: 1 },
        { name: 'createdAt_ttl', expireAfterSeconds: 43200, background: true } // 12 hours TTL
      );
      await Messages.collection.createIndex(
        { receiver: 1, createdAt: -1, time: 1 },
        { name: 'receiver_created_time_compound', background: true }
      );
      // Performance optimization indexes for device and sender queries
      await Messages.collection.createIndex(
        { 'metadata.deviceId': 1, time: -1 },
        { name: 'deviceId_time_compound', background: true }
      );
      await Messages.collection.createIndex(
        { sender: 1, time: -1 },
        { name: 'sender_time_compound', background: true }
      );
      console.log('✅ Messages indexes configured');
    } catch (error) {
      if (!error.message.includes('already exists')) {
        console.error('Messages indexes error:', error.message);
      }
    }

    // 4. Device Collection Indexes
    console.log('📱 Setting up Device indexes...');
    try {
      await Device.createIndexes();
      // Performance optimization for device list queries
      await Device.collection.createIndex(
        { isActive: 1, status: 1, lastHeartbeat: -1 },
        { name: 'active_status_heartbeat_compound', background: true }
      );
      console.log('✅ Device indexes configured');
    } catch (error) {
      if (!error.message.includes('already exists')) {
        console.error('Device indexes error:', error.message);
      }
    }

    // 5. Countries Collection Indexes
    console.log('🌍 Setting up Countries indexes...');
    try {
      await Countries.createIndexes();
      await Countries.collection.createIndex(
        { _id: 1, name: 1, flag: 1, code: 1 },
        { name: 'countries_lookup', background: true }
      );
      console.log('✅ Countries indexes configured');
    } catch (error) {
      if (!error.message.includes('already exists')) {
        console.error('Countries indexes error:', error.message);
      }
    }

    // 6. Locks Collection Indexes
    console.log('🔒 Setting up Locks indexes...');
    try {
      await Lock.createIndexes();
      // Supports paginated locks list (find {locked} sort {createdAt: -1} skip/limit)
      await Lock.collection.createIndex(
        { locked: 1, createdAt: -1 },
        { name: 'locked_created_compound', background: true }
      );
      await Lock.collection.createIndex(
        { serviceid: 1, countryid: 1, createdAt: -1 },
        { name: 'service_country_created_compound', background: true }
      );
      await Lock.collection.createIndex(
        { countryid: 1, serviceid: 1, locked: 1, number: 1 },
        { name: 'country_service_locked_number_compound', background: true }
      );
      console.log('✅ Locks indexes configured');
    } catch (error) {
      if (!error.message.includes('already exists')) {
        console.error('Locks indexes error:', error.message);
      }
    }

    console.log('✅ Database initialization complete!\n');
    return true;
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
}

/**
 * Verify database schema consistency
 * Check if all expected indexes exist
 */
export async function verifyDatabaseSchema() {
  try {
    const db = mongoose.connection.db;

    const collections = {
      numbers: ['active_countryid_compound', 'port_active_phone_compound'],
      orders: ['ttl_createdAt_15d', 'created_isused_compound', 'isused_compound', 'created_number_isused_covered'],
      messages: ['createdAt_ttl', 'receiver_created_time_compound', 'deviceId_time_compound', 'sender_time_compound'],
      devices: ['active_status_heartbeat_compound'],
      locks: ['locked_created_compound', 'service_country_created_compound', 'country_service_locked_number_compound'],
      countires: ['countries_lookup']  // Note: collection name has typo 'countires'
    };

    let allConsistent = true;

    console.log('🔍 Verifying database schema consistency...');

    for (const [collection, expectedIndexes] of Object.entries(collections)) {
      const existingIndexes = await db.collection(collection).indexes();
      const existingNames = existingIndexes.map(idx => idx.name);

      const missingIndexes = expectedIndexes.filter(
        idx => !existingNames.includes(idx)
      );

      if (missingIndexes.length > 0) {
        console.log(`⚠️  ${collection}: Missing indexes: ${missingIndexes.join(', ')}`);
        allConsistent = false;
      } else {
        console.log(`✅ ${collection}: All expected indexes present`);
      }
    }

    return allConsistent;
  } catch (error) {
    console.error('❌ Schema verification failed:', error);
    return false;
  }
}