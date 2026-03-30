import mongoose from 'mongoose';

const OrdersSchema = new mongoose.Schema({
  number: {
    type: Number,
    required: true,
  },
  countryid: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },
  serviceid: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },
  dialcode: {
    type: Number,
    required: true,
  },
  isused: {
    type: Boolean,
    default: false,
  },
  ismultiuse: {
    type: Boolean,
    default: true,    
  },
  nextsms: {
    type: Boolean,
    default: false,
  },
  message: {
    type: [String],
    default: [],
  },
  keywords: {
  type: [String],
  default: [],
  },
  formate: {
  type: [String],
  default: [],
  required: true,  
  },
  maxmessage : {
    type: Number,
  default: 0,
  },
  active: {
    type: Boolean,
    default: true,
  },
  // Failure reason tracking
  failureReason: {
    type: String,
    enum: ['none', 'expired_no_sms', 'expired_no_recharge', 'user_cancelled', 'early_cancel', 'max_messages'],
    default: 'none'
  },
  // Quality impact tracking
  qualityImpact: {
    type: Number,
    default: 0  // Negative for failures, positive for success
  },
  // Number state at order time
  numberSnapshot: {
    qualityScore: {
      type: Number,
      default: 100
    },
    consecutiveFailures: {
      type: Number,
      default: 0
    },
    signal: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true
});

// Performance indexes for quality management
OrdersSchema.index({ number: 1, active: 1, failureReason: 1 });
OrdersSchema.index({ number: 1, createdAt: -1 });

const Orders = mongoose.models.Orders || mongoose.model('Orders', OrdersSchema);

export default Orders;
