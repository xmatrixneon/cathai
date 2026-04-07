import mongoose from 'mongoose';

const MessageSchema = new mongoose.Schema({
  sender: String,
  receiver: String,
  port: String,
  time: Date,
  message: String,
  metadata: {
    deviceId: String,
    simSlot: Number,
    simCarrier: String,
    simNetworkType: String,
    networkType: String,
  }
}, { timestamps: true });

// Indexes for faster message queries in fetch script
MessageSchema.index({ receiver: 1, createdAt: -1 });
MessageSchema.index({ createdAt: -1 });

// Performance optimization indexes
MessageSchema.index({ receiver: 1, createdAt: -1, time: 1 });

// TTL Index for automatic message cleanup (12 hours)
// This index automatically deletes messages after 12 hours
MessageSchema.index(
  { createdAt: 1 },
  { name: 'createdAt_ttl', expireAfterSeconds: 43200 }
);

export default mongoose.models.Message || mongoose.model('Message', MessageSchema);