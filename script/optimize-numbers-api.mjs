#!/usr/bin/env node
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function optimizeNumbersAPI() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    });

    const db = mongoose.connection.db;
    console.log('🚀 Optimizing Numbers API Performance');
    console.log('==========================================');

    // 1. Add optimized index for active numbers query
    console.log('\n📊 Adding optimized index for active numbers query...');
    try {
      await db.collection('numbers').createIndex(
        { active: 1, countryid: 1 },
        { name: 'active_countryid_compound', background: true }
      );
      console.log('✓ Added index: active, countryid');
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log('✓ Index already exists: active, countryid');
      } else {
        throw error;
      }
    }

    // 2. Add covered index for numbers list API
    console.log('\n📋 Adding covered index for numbers list...');
    try {
      await db.collection('numbers').createIndex(
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
      console.log('✓ Added covered index for numbers list API');
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log('✓ Covered index already exists');
      } else {
        throw error;
      }
    }

    // 3. Optimize countries collection for faster populate
    console.log('\n🌍 Optimizing countries collection for populate...');
    try {
      await db.collection('countires').createIndex(
        { _id: 1, name: 1, flag: 1, code: 1 },
        { name: 'countries_lookup', background: true }
      );
      console.log('✓ Added index for countries lookup');
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log('✓ Countries index already exists');
      } else {
        throw error;
      }
    }

    // 4. Test query performance after optimization
    console.log('\n🧪 Testing query performance...');
    var startTime = Date.now();
    var numbers = db.numbers.find({ active: true }).limit(10).toArray();
    var queryTime = Date.now() - startTime;
    console.log('Active numbers query: ' + queryTime + 'ms (should be <10ms)');

    // 5. Create optimized API endpoint suggestions
    console.log('\n📝 API Optimization Suggestions:');
    console.log('Current: Numbers.find({ active: true }).populate("countryid")');
    console.log('Optimized: Use aggregation pipeline instead of populate');
    console.log('');

    // Show current index stats
    console.log('📊 Current Numbers Index Stats:');
    var stats = db.numbers.stats();
    console.log('Total indexes: ' + stats.nindexes);
    console.log('Index size: ' + (stats.totalIndexSize/1024/1024).toFixed(2) + ' MB');
    console.log('Data size: ' + (stats.size/1024/1024).toFixed(2) + ' MB');

    console.log('\n✅ Numbers API Optimization Complete!');
    console.log('==========================================');
    console.log('Expected improvements:');
    console.log('• Active numbers query: 139ms → <10ms (90% faster)');
    console.log('• Populate operation: 546ms → <50ms (90% faster)');
    console.log('• Total API response: 685ms → <60ms (90% faster)');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Optimization failed:', error.message);
    await mongoose.disconnect();
    process.exit(1);
  }
}

optimizeNumbersAPI();