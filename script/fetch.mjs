import { config } from "dotenv";
import mongoose from "mongoose";
import cron from "node-cron";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Orders from "../models/Orders.js";
import Message from "../models/Message.js";
import CronStatus from "../models/Cron.js";
import Lock from "../models/Lock.js";
import Numbers from "../models/Numbers.js";

// Get directory path for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from parent directory
config({ path: join(__dirname, "..", ".env.local") });
config({ path: join(__dirname, "..", ".env") });

// 🔗 MongoDB connection - use environment variable
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

// Escape regex special chars
const escapeRegex = (s = "") =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function normalizeToSingleLine(str = "") {
  return str
    .replace(/\r?\n|\r/g, " ")  
    .replace(/\s+/g, " ")      
    .trim();
}

// ✅ Smart OTP regex builder (fixed order: escape → insert placeholders)
function buildSmartOtpRegexList(formats) {
  if (!formats || formats.length === 0) return [];
  if (!Array.isArray(formats)) formats = [formats];

  return formats
    .map((format) => {
      format = normalizeToSingleLine(format); // ✅ multiline → single line
      if (!format.includes("{otp}")) return null;

      let pattern = escapeRegex(format);

      // ✅ Handle multiple {otp} - first one gets named group, rest get non-capturing
      let isFirstOtp = true;
      pattern = pattern.replace(/\\\{otp\\\}/gi, () => {
        if (isFirstOtp) {
          isFirstOtp = false;
          return "(?<otp>[A-Za-z0-9\\-]{3,12})";
        }
        return "(?:[A-Za-z0-9\\-]{3,12})"; // non-capturing group for subsequent {otp}
      });

      pattern = pattern.replace(/\\\{date\\\}/gi, ".*");
      pattern = pattern.replace(/\\\{datetime\\\}/gi, ".*");
      pattern = pattern.replace(/\\\{time\\\}/gi, ".*");
      pattern = pattern.replace(/\\\{random\\\}/gi, "[A-Za-z0-9]{3,15}");
      pattern = pattern.replace(/\\\{.*?\\\}/gi, ".*");

      pattern = pattern
        .replace(/\\s+/g, "\\s*")
        .replace(/\\:/g, "[:：]?");

      // ✅ Smarter dot replacement: only replace dots that are truly sentence endings
      // Don't replace dots in URLs, abbreviations, or other contexts
      pattern = pattern
        // Replace dots at end of string (like "-----ORGEN" suffix)
        .replace(/\\\.$/g, ".*")
        // Replace dots followed by space + capital letter (sentence endings)
        .replace(/\\\.\s+(?=[A-Z])|\\\.\s*$|\\\.\s*-----/g, "\\.\\s*")
        // Keep all other dots as literal (for URLs, abbreviations, etc.)
        .replace(/\\\./g, "\\.");

      return new RegExp(pattern, "i");
    })
    .filter(Boolean);
}



// ✅ Keyword filter
function containsKeywords(msg, keywords) {
  if (!keywords || keywords.length === 0) return true;
  return keywords.some((kw) =>
    msg.toLowerCase().includes(kw.toLowerCase())
  );
}

// Connect once
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((e) => {
    console.error("❌ MongoDB connection error:", e);
    process.exit(1);
  });

// Prevent overlapping runs
let running = false;

// Cron every 2 sec
cron.schedule("*/2 * * * * *", async () => {
  if (running) {
    console.log("⏭ Previous run still in progress — skipping this tick");
    return;
  }
  running = true;

  console.log("\n==============================");
  console.log("⏳ Cron start:", new Date().toISOString());

  try {
    const orders = await Orders.find({ active: true });
    console.log(`📦 Found ${orders.length} active orders`);

    for (const order of orders) {
      const now = new Date();
      const ageMinutes = (now - order.createdAt) / (1000 * 60);

      // 1️⃣ Expire after 15 min
      if (ageMinutes > 15) {
        // Determine failure reason based on message count
        let failureReason;
        let qualityImpact;

        if (order.message.length === 0) {
          // No SMS received at all - likely no recharge/balance
          failureReason = 'expired_no_recharge';
          qualityImpact = -15; // Impact quality score
        } else {
          // Some messages received - network issues or delayed OTP
          failureReason = 'expired_no_sms';
          qualityImpact = 0; // No quality impact - not the number's fault
        }

        // Update order with failure reason
        await Orders.updateOne(
          { _id: order._id },
          {
            $set: {
              active: false,
              updatedAt: now,
              failureReason: failureReason,
              qualityImpact: qualityImpact
            }
          }
        );

        // Update number quality ONLY if no-recharge failure
        if (qualityImpact !== 0) {
          await updateNumberQuality(order.number, qualityImpact, failureReason, order._id);
        }

        console.log(`   ⌛ Order ${order._id} expired (${failureReason})`);
        continue;
      }

   const messageLength = order.message.length;

// ✅ Check message limit
if (order.maxmessage !== 0 && messageLength >= order.maxmessage) {
  console.log("❌ Message limit reached!");
        continue;
} 
      // Handle both old and new number formats for backward compatibility
      const orderNumberStr = order.number.toString();
      let fullNumber, numberWithCountry;
      
      if (order.dialcode === 91 && orderNumberStr.length === 12 && orderNumberStr.startsWith('91')) {
        // Old format: 12-digit number already includes 91
        numberWithCountry = orderNumberStr;
        fullNumber = `+${orderNumberStr}`;
      } else if (order.dialcode === 91 && orderNumberStr.length === 10 && !orderNumberStr.startsWith('91')) {
        // New format: 10-digit number without 91 prefix + 91 dialcode
        numberWithCountry = `91${orderNumberStr}`;
        fullNumber = `+${numberWithCountry}`;
      } else if (order.dialcode === 91 && orderNumberStr.length === 10 && orderNumberStr.startsWith('91')) {
        // Edge case: 10-digit number that already starts with 91 (like 9156789012)
        numberWithCountry = orderNumberStr;
        fullNumber = `+${orderNumberStr}`;
      } else {
        // Other countries or formats
        numberWithCountry = `${order.dialcode}${orderNumberStr}`;
        fullNumber = `+${numberWithCountry}`;
      }
      
      console.log(
        `\n🔍 Order ${order._id} — number: ${order.number} (full: ${fullNumber})`
      );

      const escapedFullNumber = escapeRegex(fullNumber);
      const escapedNumberOnly = escapeRegex(orderNumberStr);
      const escapedNumberWithCountry = escapeRegex(numberWithCountry);

      // Build regex list from templates
      const otpRegexList = buildSmartOtpRegexList(order.formate);

// ✅ Base time = order createdAt (never changes, unlike updatedAt)
const baseTime = order.createdAt;

// ✅ Look back 3 minutes to catch any delayed messages
const sinceTime = new Date(baseTime.getTime() - 180000);

// ✅ Sirf uske baad ke messages uthao (use 'time' field for SMS timestamp)
const timeFilter = {
  time: { $gt: sinceTime },
};


      // Handle receiver matching with and without 91 prefix
      const receiverMatches = [
        { receiver: fullNumber },
        { receiver: order.number.toString() },
        { receiver: numberWithCountry },
      ];
      
      // Also match receivers that might have 91 prefix (for all 10-digit Indian numbers)
      if (order.dialcode === 91 && orderNumberStr.length === 10) {
        receiverMatches.push({ receiver: `91${orderNumberStr}` });
        receiverMatches.push({ receiver: `+91${orderNumberStr}` });
      }
      
      const receiverOrTextFilter = {
        $or: [
          ...receiverMatches,
          { message: new RegExp(escapedFullNumber, "i") },
          { message: new RegExp(escapedNumberOnly, "i") },
          { message: new RegExp(escapedNumberWithCountry, "i") },
        ],
      };

      let messages = await Message.find({
        $and: [receiverOrTextFilter, timeFilter],
      }).sort({ createdAt: 1 });

      console.log(`   ✉️  Matched messages (exact): ${messages.length}`);

      // 🔍 PARTIAL MATCH FALLBACK: If no messages found, try matching last 10 digits
      if (messages.length === 0 && orderNumberStr.length >= 10) {
        const last10Digits = orderNumberStr.slice(-10);
        const partialReceiverFilter = {
          $or: [
            { receiver: new RegExp(last10Digits + ".*", "i") },
            { message: new RegExp(last10Digits + ".*", "i") },
          ],
        };

        messages = await Message.find({
          $and: [partialReceiverFilter, timeFilter],
        }).sort({ createdAt: 1 });

        if (messages.length > 0) {
          console.log(`   🔍 Matched messages (partial): ${messages.length} - using last 10 digits: ${last10Digits}`);
        }
      }
      // 🚦 Multi-use logic
      if (order.message.length > 0) {
        if (!order.ismultiuse) {
          console.log("   ⛔ Already has OTP, multiuse=false → skip");
          continue;
        }
        if (!order.nextsms) {
          console.log("   ⏸ Multiuse enabled but nextsms=false → wait");
          continue;
        }
      }

      for (const msg of messages) {
        // 🚫 Skip if already saved
        if (order.message.includes(msg.message)) {
          console.log("      ⏭ Already saved message, skipping");
          continue;
        }

        if (!containsKeywords(msg.message, order.keywords)) {
          console.log("      ❌ Skipped (keywords not matched)");
          continue;
        }

        console.log(`   └ Message from ${msg.sender}`);
        console.log(`      text: ${msg.message}`);

let otpFound = null;

// ✅ normalize message ek line me
const cleanMessage = normalizeToSingleLine(msg.message);

for (const regex of otpRegexList) {
  const m = regex.exec(cleanMessage);
  otpFound = m?.groups?.otp || (m && m[1]) || null;
  if (otpFound) {
    console.log("      ✅ extracted OTP via format regex");
    break;
  }
}


        if (otpFound) {
          const updateFields = {
            updatedAt: new Date(),
            nextsms: false,
          };

          // First OTP = success
          if (order.message.length === 0) {
            updateFields.isused = true;
            updateFields.failureReason = 'none';
            updateFields.qualityImpact = 5; // +5 points for success

            // Record number state snapshot
            const numDoc = await Numbers.findOne({ number: order.number });
            updateFields.numberSnapshot = {
              qualityScore: numDoc ? (numDoc.qualityScore || 100) : 100,
              consecutiveFailures: numDoc ? (numDoc.consecutiveFailures || 0) : 0,
              signal: 0 // Can be enhanced later
            };

            // Update number quality
            await updateNumberQuality(order.number, 5, 'otp_received', order._id);

            const newLock = new Lock({
              number: order.number,
              countryid: order.countryid,
              serviceid: order.serviceid,
              locked: true,
            });

            await newLock.save();
            console.log("      🔒 First OTP received → marking order as used");
          }

          await Orders.updateOne(
            { _id: order._id },
            {
              $set: updateFields,
              $addToSet: { message: msg.message },
            }
          );

          console.log(`      💾 Saved OTP: ${otpFound}`);
          break; // save only one OTP per run
        } else {
          console.log("      ⚠ No OTP found (formats didn’t match)");
        }
      }
    }

    console.log("⏹ Cron finished:", new Date().toISOString());
  } catch (err) {
    console.error("❌ Cron runtime error:", err);
  } finally {
    await CronStatus.findOneAndUpdate(
      { name: "fetchOrders" },
      { lastRun: new Date() },
      { upsert: true, new: true }
    );
    running = false;
  }
});

// Helper: Get current quality score for a number
async function getNumberQualityScore(number) {
  const numDoc = await Numbers.findOne({ number });
  return numDoc ? numDoc.qualityScore || 100 : 100;
}

// Helper: Get consecutive failures
async function getNumberConsecutiveFailures(number) {
  const numDoc = await Numbers.findOne({ number });
  return numDoc ? numDoc.consecutiveFailures || 0 : 0;
}

// Helper: Update number quality in real-time
async function updateNumberQuality(number, impact, reason, orderId) {
  const numDoc = await Numbers.findOne({ number });

  if (!numDoc) {
    console.warn(`      ⚠️ Number ${number} not found for quality update`);
    return;
  }

  const now = new Date();
  let newQualityScore = Math.max(0, Math.min(100, (numDoc.qualityScore || 100) + impact));
  let newConsecutiveFailures = numDoc.consecutiveFailures || 0;
  let newFailureCount = numDoc.failureCount || 0;
  let newSuccessCount = numDoc.successCount || 0;

  // Update counters
  if (impact > 0) {
    newSuccessCount++;
    newConsecutiveFailures = 0; // Reset on success
    numDoc.lastSuccessAt = now;
  } else {
    newFailureCount++;
    newConsecutiveFailures++;
    numDoc.lastFailureAt = now;
  }

  // Add to recent failures (max 50)
  const recentFailure = {
    orderId: orderId,
    serviceid: numDoc.serviceid || null,
    countryid: numDoc.countryid || null,
    failedAt: now,
    reason: reason
  };

  const recentFailures = numDoc.recentFailures || [];
  recentFailures.push(recentFailure);
  if (recentFailures.length > 50) {
    recentFailures.shift(); // Keep only last 50
  }

  await Numbers.updateOne(
    { _id: numDoc._id },
    {
      $set: {
        qualityScore: newQualityScore,
        failureCount: newFailureCount,
        successCount: newSuccessCount,
        consecutiveFailures: newConsecutiveFailures,
        lastFailureAt: impact < 0 ? now : numDoc.lastFailureAt,
        lastSuccessAt: impact > 0 ? now : numDoc.lastSuccessAt,
        recentFailures: recentFailures,
        lastQualityCheck: now
      }
    }
  );

  console.log(`      📊 Quality ${number}: ${newQualityScore} (${impact > 0 ? '+' : ''}${impact})`);
}
