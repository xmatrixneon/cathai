// jobs/handlers/fetch-handler.js
import Orders from '../../models/Orders.js';
import Message from '../../models/Message.js';
import Numbers from '../../models/Numbers.js';

// Escape regex special chars
const escapeRegex = (s = "") =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function normalizeToSingleLine(str = "") {
  return str
    .replace(/\r?\n|\r/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Smart OTP regex builder
function buildSmartOtpRegexList(formats) {
  if (!formats || formats.length === 0) return [];
  if (!Array.isArray(formats)) formats = [formats];

  return formats
    .map((format) => {
      format = normalizeToSingleLine(format);
      if (!format.includes("{otp}")) return null;

      let pattern = escapeRegex(format);

      let isFirstOtp = true;
      pattern = pattern.replace(/\\\{otp\\\}/gi, () => {
        if (isFirstOtp) {
          isFirstOtp = false;
          return "(?<otp>[A-Za-z0-9\\-]{3,12})";
        }
        return "(?:[A-Za-z0-9\\-]{3,12})";
      });

      pattern = pattern.replace(/\\\{date\\\}/gi, ".*");
      pattern = pattern.replace(/\\\{datetime\\\}/gi, ".*");
      pattern = pattern.replace(/\\\{time\\\}/gi, ".*");
      pattern = pattern.replace(/\\\{random\\\}/gi, "[A-Za-z0-9]{3,15}");
      pattern = pattern.replace(/\\\{.*?\\\}/gi, ".*");

      pattern = pattern
        .replace(/\\s+/g, "\\s*")
        .replace(/\\:/g, "[:：]?")
        .replace(/\\\./g, ".*");

      return new RegExp(pattern, "i");
    })
    .filter(Boolean);
}

// Keyword filter
function containsKeywords(msg, keywords) {
  if (!keywords || keywords.length === 0) return true;
  return keywords.some((kw) =>
    msg.toLowerCase().includes(kw.toLowerCase())
  );
}

export async function handleFetchJob(data) {
  const startTime = Date.now();
  let processed = 0;
  let errors = 0;
  let otpsFound = 0;

  try {
    console.log('[Fetch] Starting OTP fetch job');

    // Find active orders
    const activeOrders = await Orders.find({ active: true });
    console.log(`[Fetch] Found ${activeOrders.length} active orders`);

    for (const order of activeOrders) {
      processed++;
      const now = new Date();
      const ageMinutes = (now - order.createdAt) / (1000 * 60);

      // Expire after 15 min
      if (ageMinutes > 15) {
        let failureReason = order.message.length === 0 ? 'expired_no_sms' : 'expired_no_recharge';

        await Orders.findByIdAndUpdate(order._id, {
          active: false,
          failureReason,
          qualityImpact: -5,
        });
        console.log(`[Fetch] Order ${order._id} expired (${ageMinutes.toFixed(1)}min) - ${failureReason}`);
        continue;
      }

      // Get service for regex patterns
      const service = await mongoose.connection.db.collection('services').findOne({
        code: order.serviceid,
        active: true
      });

      if (!service) {
        console.log(`[Fetch] Service ${order.serviceid} not found for order ${order._id}`);
        continue;
      }

      // Find messages for this order's number
      const messages = await Message.find({
        receiver: order.number,
        time: { $gt: order.createdAt }
      }).sort({ time: -1 }).limit(10);

      // Check for new messages
      for (const msg of messages) {
        // Skip if message content already in order
        if (order.message.includes(msg.message)) continue;

        // Check keywords
        if (!containsKeywords(msg.message, service.keywords || [])) continue;

        // Try to extract OTP
        let otp = null;
        if (service.formate && service.formate.length > 0) {
          const regexList = buildSmartOtpRegexList(service.formate);
          for (const regex of regexList) {
            const match = msg.message.match(regex);
            if (match && match.groups && match.groups.otp) {
              otp = match.groups.otp;
              break;
            }
          }
        }

        // Add message to order
        await Orders.findByIdAndUpdate(order._id, {
          $push: {
            message: msg.message
          }
        });

        console.log(`[Fetch] Order ${order._id} - new message: ${msg.message.substring(0, 50)}...`);

        if (otp) {
          otpsFound++;
          console.log(`[Fetch] Order ${order._id} - OTP found: ${otp}`);
        }
      }
    }

    return {
      success: true,
      processed,
      errors,
      duration: Date.now() - startTime,
      details: {
        activeOrders: activeOrders.length,
        otpsFound,
      },
    };
  } catch (error) {
    errors++;
    console.error('[Fetch] Error:', error.message);
    return {
      success: false,
      processed,
      errors,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}
