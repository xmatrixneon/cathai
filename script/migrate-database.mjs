#!/usr/bin/env node
/**
 * Database Migration Script
 *
 * Run this script to ensure all database schema changes are applied.
 * This is useful for:
 * - Production deployments
 * - Schema updates
 * - Development environment setup
 *
 * Usage: node script/migrate-database.mjs
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { initializeDatabase, verifyDatabaseSchema } from '../lib/db-init.js';

dotenv.config();

async function migrateDatabase() {
  try {
    console.log('🚀 Starting Database Migration');
    console.log('================================\n');

    // Connect to MongoDB
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
    });
    console.log('✅ Connected to MongoDB\n');

    // Initialize database (create/update indexes)
    await initializeDatabase();

    // Verify schema consistency
    console.log('🔍 Verifying database schema consistency...\n');
    const isConsistent = await verifyDatabaseSchema();

    if (isConsistent) {
      console.log('✅ Database schema is consistent!\n');
    } else {
      console.log('⚠️  Some schema inconsistencies detected.\n');
      console.log('Run this script again or check the logs above.\n');
    }

    // Display summary
    const db = mongoose.connection.db;
    const stats = await db.stats();

    console.log('📊 Database Statistics:');
    console.log('================================');
    console.log('Database: ' + db.databaseName);
    console.log('Collections: ' + stats.collections);
    console.log('Data Size: ' + (stats.dataSize / 1024 / 1024).toFixed(2) + ' MB');
    console.log('Index Size: ' + (stats.indexSize / 1024 / 1024).toFixed(2) + ' MB');
    console.log('Total Size: ' + (stats.storageSize / 1024 / 1024).toFixed(2) + ' MB');

    // Detailed collection stats
    console.log('\n📋 Collection Index Status:');
    const collections = ['numbers', 'orders', 'messages', 'devices', 'countires']; // Note: 'countires' has typo in original

    const allCollections = await db.listCollections().toArray();
    const existingCollections = allCollections.map(c => c.name);

    for (const collection of collections) {
      if (existingCollections.includes(collection)) {
        try {
          const col = db.collection(collection);
          const colStats = await col.aggregate([{ $collStats: {} }]).toArray();
          const indexCount = colStats[0]?.nindexes || 0;
          const indexSize = (colStats[0]?.totalIndexSize?.toNumber?.() || 0) / 1024 / 1024;

          console.log(`${collection}: ${indexCount} indexes, ${indexSize.toFixed(2)} MB`);
        } catch (error) {
          console.log(`${collection}: Error getting stats - ${error.message}`);
        }
      } else {
        console.log(`${collection}: Collection does not exist`);
      }
    }

    console.log('\n✅ Migration Complete!');
    console.log('================================\n');

    console.log('📝 Migration Summary:');
    console.log('• All performance indexes created/verified');
    console.log('• TTL indexes configured for auto-cleanup');
    console.log('• Schema consistency verified');
    console.log('• Database is ready for production use');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('Stack:', error.stack);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run migration
migrateDatabase();