import mongoose from 'mongoose';

const NumbersSchema = new mongoose.Schema({
  number: {
    type: Number,
    required: true,
    unique: true,
  },
  countryid: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: "Country" // optional reference
  },
  multiuse: {
    type: Boolean,
    default: false,
  },
  multigap: {
    type: Number,
    default: 0,
  },
  active: {
    type: Boolean,
    default: true,
  },
  locked: {
    type: Boolean,
    default: false,   // port lock/unlock state
  },
  lastRotation: {
    type: Date,
    default: null,    // last time this number/port was rotated
  },
  iccid: {
    type: String,
    default: null,    // SIM card ICCID
  },
  imsi: {
    type: String,
    default: null,    // SIM IMSI
  },
  operator: {
    type: String,
    default: null,    // Network operator (e.g., Vi, Airtel, Jio)
  },
  signal: {
    type: Number,
    default: 0,       // last known signal strength
  },
  port: {
    type: String,
    default: null,    // Gateway port like "1.01"
  },
  // Quality tracking
  qualityScore: {
    type: Number,
    default: 100,
    min: 0,
    max: 100,
    index: true
  },
  // Suspension state
  suspended: {
    type: Boolean,
    default: false,
    index: true
  },
  suspensionReason: {
    type: String,
    enum: ['none', 'low_quality', 'manual', 'high_failure_rate', 'no_recharge', 'low_sms'],
    default: 'none'
  },
  suspendedAt: {
    type: Date,
    default: null
  },
  // Failure tracking
  failureCount: {
    type: Number,
    default: 0
  },
  successCount: {
    type: Number,
    default: 0
  },
  // Consecutive failure tracking
  consecutiveFailures: {
    type: Number,
    default: 0
  },
  lastFailureAt: {
    type: Date,
    default: null
  },
  lastSuccessAt: {
    type: Date,
    default: null
  },
  // Statistics window (for rolling calculations)
  recentFailures: [{
    orderId: mongoose.Schema.Types.ObjectId,
    serviceid: mongoose.Schema.Types.ObjectId,
    countryid: mongoose.Schema.Types.ObjectId,
    failedAt: Date,
    reason: String
  }],
  // Recovery tracking
  lastQualityCheck: {
    type: Date,
    default: null
  },
  // Low SMS suspension tracking
  lowSmsSuspensionCount: {
    type: Number,
    default: 0
  },
  lastLowSmsCheck: {
    type: Date,
    default: null
  },
  smsReceivedInWindow: {
    type: Number,
    default: 0
  }
});

// Performance indexes for quality management
NumbersSchema.index({ qualityScore: 1, suspended: 1, active: 1 });
NumbersSchema.index({ suspended: 1, suspendedAt: 1 });
NumbersSchema.index({ 'recentFailures.failedAt': 1 });

// Prevent model overwrite in dev
const Numbers = mongoose.models.Numbers || mongoose.model('Numbers', NumbersSchema);

export default Numbers;
