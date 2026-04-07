#!/usr/bin/env node
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function checkMongoStats() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 3000,
      connectTimeoutMS: 3000,
    });

    const admin = mongoose.connection.db.admin();
    const stats = await admin.serverStatus();
    const cache = stats.wiredTiger.cache;

    console.log('📊 MongoDB Performance Stats:');
    console.log('================================');
    console.log(`Cache Usage: ${(cache['bytes currently in the cache'] / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Cache Dirty: ${(cache['tracked dirty bytes in the cache'] / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Cache Overhead: ${(cache['percentage overhead'] || 0)}%`);
    console.log(`\nEvictions: ${cache['pages evicted by application threads']}`);
    console.log(`Reads from disk: ${cache['pages read into cache']}`);
    console.log(`Writes to disk: ${cache['pages written from cache']}`);
    console.log(`Cache hits ratio: ${(((stats.wiredTiger.cache['pages requested from cache'] || 0) - (cache['pages read into cache'] || 0)) / Math.max(stats.wiredTiger.cache['pages requested from cache'] || 1, 1) * 100).toFixed(2)}%`);

    const connStats = stats.connections;
    console.log(`\n🔗 Connections:`);
    console.log(`Current: ${connStats.current}/${connStats.available}`);
    console.log(`Active: ${connStats.active}`);
    console.log(`Total created: ${connStats.totalCreated}`);

    const dbStats = stats.opcounters || {};
    console.log(`\n💾 Database Activity:`);
    console.log(`Inserts: ${dbStats.insert || 0}`);
    console.log(`Queries: ${dbStats.query || 0}`);
    console.log(`Updates: ${dbStats.update || 0}`);
    console.log(`Deletes: ${dbStats.delete || 0}`);

    console.log(`\n⏱️  Uptime: ${(stats.uptime / 1000 / 60).toFixed(2)} minutes`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ MongoDB stats check failed:', error.message);
    await mongoose.disconnect();
    process.exit(1);
  }
}

checkMongoStats();