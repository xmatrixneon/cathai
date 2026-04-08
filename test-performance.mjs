import mongoose from 'mongoose';

await mongoose.connect('mongodb://smsgateway:Lauda%409798@localhost:27017/smsgateway?authSource=admin');

console.log('=== PERFORMANCE ANALYSIS ===\n');

// 1. Count devices
const deviceCount = await mongoose.connection.db.collection('devices').countDocuments({ isActive: true });
console.log('Active Devices:', deviceCount);

// 2. Count active numbers
const numberCount = await mongoose.connection.db.collection('numbers').countDocuments({ active: true });
console.log('Active Numbers:', numberCount);

// 3. Count active orders
const orderCount = await mongoose.connection.db.collection('orders').countDocuments({ active: true });
console.log('Active Orders:', orderCount);

// 4. Count messages
const messageCount = await mongoose.connection.db.collection('messages').estimatedDocumentCount();
console.log('Total Messages:', messageCount);

// 5. Check indexes
console.log('\n=== INDEXES ===');
const deviceIndexes = await mongoose.connection.db.collection('devices').indexes();
console.log('Devices indexes:', deviceIndexes.length);
deviceIndexes.forEach(idx => console.log('  -', JSON.stringify(idx.key)));

const messageIndexes = await mongoose.connection.db.collection('messages').indexes();
console.log('Messages indexes:', messageIndexes.length);

const orderIndexes = await mongoose.connection.db.collection('orders').indexes();
console.log('Orders indexes:', orderIndexes.length);

// 6. Test query performance
console.log('\n=== QUERY PERFORMANCE ===');

const start1 = Date.now();
const devices = await mongoose.connection.db.collection('devices').find({ isActive: true }).limit(10).toArray();
console.log('Find 10 devices:', Date.now() - start1, 'ms');

const start2 = Date.now();
const messages = await mongoose.connection.db.collection('messages').find({}).limit(10).toArray();
console.log('Find 10 messages:', Date.now() - start2, 'ms');

const start3 = Date.now();
await mongoose.connection.db.collection('orders').find({ active: true }).limit(10).toArray();
console.log('Find 10 orders:', Date.now() - start3, 'ms');

await mongoose.disconnect();
