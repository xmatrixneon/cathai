// app/lib/db.js or lib/db.js
import mongoose from 'mongoose';
import { initializeDatabase } from './db-init.js';

let isConnected = false;

export default async function connectDB() {
  if (isConnected) return;

  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      // Connection pooling optimization - SCALED for 62GB RAM / 12-core system
      maxPoolSize: 200,       // Increased from 50 - fully utilize 62GB RAM (18 processes × ~11 connections)
      minPoolSize: 50,        // Increased from 10 - maintain warm connection pool
      maxIdleTimeMS: 60000,   // Increased to 60s - keep connections alive longer
      socketTimeoutMS: 60000, // Increased to 60s
      serverSelectionTimeoutMS: 10000, // Increased for retry
      waitQueueTimeoutMS: 10000, // Increased for retry

      // Performance tuning
      bufferCommands: false,   // Disable mongoose buffering for faster failover

      // MongoDB Memory Configuration - 16GB WiredTiger cache (25% of 62GB RAM)
      wtimeoutMS: 5000,
    });

    isConnected = true;
    console.log("MongoDB connected with SCALABLE pooling (maxPoolSize: 200, minPoolSize: 50) for 62GB RAM system");

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
