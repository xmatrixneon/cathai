import mongoose from 'mongoose';
import Numbers from '../models/Numbers.js';
import Orders from '../models/Orders.js';
import Messages from '../models/Message.js';
import Countries from '../models/Countires.js';

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
        {
          active: 1,
          suspended: 1,
          countryid: 1,
          qualityScore: -1,
          operator: 1,
          signal: -1
        },
        { name: 'covered_numbers_list', background: true }
      );
      await Numbers.collection.createIndex(
        { active: 1, suspended: 1, operator: 1, qualityScore: -1 },
        { name: 'active_suspended_operator_quality_compound', background: true }
      );
      await Numbers.collection.createIndex(
        { port: 1, active: 1, 'sims.phoneNumber': 1 },
        { name: 'port_active_phone_compound', background: true }
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
      await Orders.collection.createIndex(
        { countryid: 1, serviceid: 1, active: 1, createdAt: -1 },
        { name: 'country_service_active_created_compound', background: true }
      );
      await Orders.collection.createIndex(
        { active: 1, isused: 1, createdAt: -1 },
        { name: 'active_isused_created_compound', background: true }
      );
      await Orders.collection.createIndex(
        { active: 1, failureReason: 1, createdAt: -1 },
        { name: 'active_failure_created_compound', background: true }
      );
      await Orders.collection.createIndex(
        {
          number: 1,
          active: 1,
          countryid: 1,
          serviceid: 1,
          createdAt: -1,
          isused: 1
        },
        { name: 'covered_number_allocation', background: true }
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
      console.log('✅ Messages indexes configured');
    } catch (error) {
      if (!error.message.includes('already exists')) {
        console.error('Messages indexes error:', error.message);
      }
    }

    // 4. Countries Collection Indexes
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
      numbers: ['active_countryid_compound', 'covered_numbers_list'],
      orders: ['country_service_active_created_compound', 'active_isused_created_compound'],
      messages: ['createdAt_ttl', 'receiver_created_time_compound'],
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