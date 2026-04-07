// app/lib/db.js or lib/db.js
import mongoose from 'mongoose';
import { initializeDatabase } from './db-init';

let isConnected = false;

export default async function connectDB() {
  if (isConnected) return;

  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,

      // Connection pooling optimization
      maxPoolSize: 50,        // Increased for BullMQ worker concurrency
      minPoolSize: 10,        // Increased for BullMQ worker concurrency
      maxIdleTimeMS: 30000,   // Close idle connections after 30s
      socketTimeoutMS: 45000, // Socket timeout
      serverSelectionTimeoutMS: 5000,
      waitQueueTimeoutMS: 5000, // Timeout if no connection available

      // Performance tuning
      bufferCommands: false,   // Disable mongoose buffering for faster failover
    });

    isConnected = true;
    console.log("MongoDB connected with BullMQ-optimized pooling (maxPoolSize: 50, minPoolSize: 10)");

    // Initialize database indexes on first connection
    await initializeDatabase();

    // Monitor connection events for production monitoring
    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      isConnected = false;
      console.log('MongoDB disconnected - will reconnect automatically');
    });

    mongoose.connection.on('reconnected', () => {
      isConnected = true;
      console.log('MongoDB reconnected successfully');
    });

  } catch (error) {
    console.error("MongoDB connection error:", error);
    throw error;
  }
}
