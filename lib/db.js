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
      maxPoolSize: 20,        // Increase from default 10 to 20
      minPoolSize: 5,         // Keep minimum connections ready
      maxIdleTimeMS: 30000,   // Close idle connections after 30s
      socketTimeoutMS: 45000, // Socket timeout
      serverSelectionTimeoutMS: 5000,

      // Performance tuning
      bufferCommands: false,   // Disable mongoose buffering for faster failover
    });

    isConnected = true;
    console.log("MongoDB connected with optimized pooling settings");

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
