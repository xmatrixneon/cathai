import { config } from "dotenv";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import mongoose from 'mongoose';
import { handleStatusJob } from './jobs/handlers/status-handler.js';
import Numbers from './models/Numbers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '.env.local') });
config({ path: join(__dirname, '.env') });

const MONGO_URI = process.env.MONGODB_URI;

async function test() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('Connected');

  const activeBefore = await Numbers.countDocuments({ active: true });
  console.log('Active numbers before:', activeBefore);

  console.log('\nRunning status handler...');
  const result = await handleStatusJob({});
  console.log('Result:', JSON.stringify(result.details, null, 2));

  const activeAfter = await Numbers.countDocuments({ active: true });
  console.log('\nActive numbers after:', activeAfter);

  await mongoose.disconnect();
  process.exit(0);
}

test().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
