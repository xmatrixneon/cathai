import mongoose from 'mongoose';
import Service from './models/Service.js';

await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/cattysms');

await new Promise((resolve) => mongoose.connection.once('connected', resolve));

const services = await Service.find({ active: true }, { code: 1, formate: 1, keywords: 1 }).limit(30);

console.log('Active Services and their OTP Formats:\n');
services.forEach(s => {
  console.log('---', s.code, '---');
  console.log('Formate:', JSON.stringify(s.formate));
  console.log('Keywords:', JSON.stringify(s.keywords));
  console.log();
});

await mongoose.disconnect();
