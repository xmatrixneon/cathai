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

export default mongoose.models.Message || mongoose.model('Message', MessageSchema);