import mongoose from 'mongoose';
import { initializeDatabase } from '../lib/db-init.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/smsgateway';

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  await initializeDatabase();
  console.log('Database initialization complete');

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
