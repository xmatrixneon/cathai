// Test Batch Fetch Handler - Does NOT modify production code
// Run with: node test-batch-fetch.mjs

import { config } from 'dotenv';
config({ path: '.env' });

import mongoose from 'mongoose';
import connectDB from './lib/db.js';
import Orders from './models/Orders.js';
import Message from './models/Message.js';
import Numbers from './models/Numbers.js';
import Lock from './models/Lock.js';

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

// Helper: Update number quality in real-time
async function updateNumberQuality(number, impact, reason, orderId) {
  const numDoc = await Numbers.findOne({ number });

  if (!numDoc) {
    console.warn(`      [BatchFetch] Number ${number} not found for quality update`);
    return;
  }

  const now = new Date();
  let newQualityScore = Math.max(0, Math.min(100, (numDoc.qualityScore || 100) + impact));
  let newConsecutiveFailures = numDoc.consecutiveFailures || 0;
  let newFailureCount = numDoc.failureCount || 0;
  let newSuccessCount = numDoc.successCount || 0;

  if (impact > 0) {
    newSuccessCount++;
    newConsecutiveFailures = 0;
  } else {
    newFailureCount++;
    newConsecutiveFailures++;
  }

  const recentFailure = {
    orderId: orderId,
    failedAt: now,
    reason: reason
  };

  const recentFailures = numDoc.recentFailures || [];
  recentFailures.push(recentFailure);
  if (recentFailures.length > 50) {
    recentFailures.shift();
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

  console.log(`      [BatchFetch] Quality ${number}: ${newQualityScore} (${impact > 0 ? '+' : ''}${impact})`);
}

export async function testBatchFetchJob() {
  const startTime = Date.now();
  let processed = 0;
  let errors = 0;
  let otpsFound = 0;

  try {
    console.log('[BatchFetch] Starting batch fetch test');
    console.log('[BatchFetch] ===========================================');

    // Find active orders
    const activeOrders = await Orders.find({ active: true });
    console.log(`[BatchFetch] Found ${activeOrders.length} active orders`);

    if (activeOrders.length === 0) {
      console.log('[BatchFetch] No active orders to process');
      return { success: true, processed: 0, duration: 0 };
    }

    // === BATCH APPROACH: Get all recent messages FIRST ===
    // Find the oldest order creation time to set the query window
    const minCreatedAt = activeOrders.reduce((min, order) =>
      order.createdAt < min ? order.createdAt : min, activeOrders[0].createdAt);

    // Look back 3 minutes from the oldest order
    const sinceTime = new Date(minCreatedAt.getTime() - 180000);

    console.log(`[BatchFetch] Fetching all messages since ${sinceTime.toISOString()}`);

    const allRecentMessages = await Message.find({
      time: { $gte: sinceTime }
    }).sort({ createdAt: 1 });

    console.log(`[BatchFetch] Fetched ${allRecentMessages.length} total recent messages`);

    // Group messages by receiver number for fast lookup
    const messagesByReceiver = new Map();

    for (const msg of allRecentMessages) {
      const receiver = msg.receiver || "";
      if (!messagesByReceiver.has(receiver)) {
        messagesByReceiver.set(receiver, []);
      }
      messagesByReceiver.get(receiver).push(msg);
    }

    console.log(`[BatchFetch] Grouped into ${messagesByReceiver.size} unique receiver numbers`);

    // === PROCESS EACH ORDER (no DB queries, just in-memory lookup) ===
    const orderUpdates = [];
    const numberQualityUpdates = [];
    const locksToCreate = [];

    for (const order of activeOrders) {
      processed++;
      const now = new Date();
      const ageMinutes = (now - order.createdAt) / (1000 * 60);

      // 1. Expire after 15 min
      if (ageMinutes > 15) {
        let failureReason;
        let qualityImpact;

        if (order.message.length === 0) {
          failureReason = 'expired_no_recharge';
          qualityImpact = -15;
        } else {
          failureReason = 'expired_no_sms';
          qualityImpact = 0;
        }

        orderUpdates.push({
          updateOne: {
            filter: { _id: order._id },
            update: {
              $set: {
                active: false,
                updatedAt: now,
                failureReason: failureReason,
                qualityImpact: qualityImpact
              }
            }
          }
        });

        if (qualityImpact !== 0) {
          numberQualityUpdates.push({
            number: order.number,
            impact: qualityImpact,
            reason: failureReason,
            orderId: order._id
          });
        }

        console.log(`[BatchFetch] Order ${order._id} expired (${ageMinutes.toFixed(1)}min) - ${failureReason}`);
        continue;
      }

      const messageLength = order.message.length;

      // 2. Check message limit
      if (order.maxmessage !== 0 && messageLength >= order.maxmessage) {
        console.log(`[BatchFetch] Order ${order._id} - message limit reached (${messageLength}/${order.maxmessage})`);
        continue;
      }

      // 3. Find messages for this order (from in-memory map)
      const orderNumberStr = order.number.toString();
      let fullNumber, numberWithCountry;

      if (order.dialcode === 91 && orderNumberStr.length === 12 && orderNumberStr.startsWith('91')) {
        numberWithCountry = orderNumberStr;
        fullNumber = `+${orderNumberStr}`;
      } else if (order.dialcode === 91 && orderNumberStr.length === 10 && !orderNumberStr.startsWith('91')) {
        numberWithCountry = `91${orderNumberStr}`;
        fullNumber = `+${numberWithCountry}`;
      } else if (order.dialcode === 91 && orderNumberStr.length === 10 && orderNumberStr.startsWith('91')) {
        numberWithCountry = orderNumberStr;
        fullNumber = `+${orderNumberStr}`;
      } else {
        numberWithCountry = `${order.dialcode}${orderNumberStr}`;
        fullNumber = `+${numberWithCountry}`;
      }

      // Look up messages from the grouped map (NO DB QUERY!)
      let messages = [];

      // Try exact receiver match first
      const exactMatches = messagesByReceiver.get(fullNumber) ||
                         messagesByReceiver.get(orderNumberStr.toString()) ||
                         messagesByReceiver.get(numberWithCountry);

      if (exactMatches) {
        messages = exactMatches.filter(msg => {
          const orderTime = order.createdAt.getTime();
          const msgTime = new Date(msg.time || msg.createdAt || Date.now()).getTime();
          return msgTime >= orderTime - 180000 && msgTime <= orderTime + 900000;
        });
      }

      // PARTIAL MATCH FALLBACK
      if (messages.length === 0 && orderNumberStr.length >= 10) {
        const last10Digits = orderNumberStr.slice(-10);

        // Search through all message arrays for partial match
        for (const [receiver, msgs] of messagesByReceiver) {
          if (receiver.includes(last10Digits) || receiver.endsWith(last10Digits)) {
            const partialMatches = msgs.filter(msg => {
              const orderTime = order.createdAt.getTime();
              const msgTime = new Date(msg.time || msg.createdAt || Date.now()).getTime();
              return msgTime >= orderTime - 180000 && msgTime <= orderTime + 900000;
            });

            if (partialMatches.length > 0) {
              messages = partialMatches;
              break;
            }
          }
          if (messages.length > 0) break;
        }

        if (messages.length > 0) {
          console.log(`[BatchFetch] Order ${order._id} - matched messages (partial): ${messages.length}`);
        }
      } else if (messages.length > 0) {
        console.log(`[BatchFetch] Order ${order._id} - matched messages (exact): ${messages.length}`);
      }

      // 4. Multi-use logic
      if (order.message.length > 0) {
        if (!order.ismultiuse) {
          console.log(`[BatchFetch] Order ${order._id} - already has OTP, multiuse=false -> skip`);
          continue;
        }
        if (!order.nextsms) {
          console.log(`[BatchFetch] Order ${order._id} - multiuse enabled but nextsms=false -> wait`);
          continue;
        }
      }

      for (const msg of messages) {
        // Skip if already saved
        if (order.message.includes(msg.message)) {
          console.log(`[BatchFetch] Order ${order._id} - message already saved, skipping`);
          continue;
        }

        if (!containsKeywords(msg.message, order.keywords)) {
          console.log(`[BatchFetch] Order ${order._id} - skipped (keywords not matched)`);
          continue;
        }

        console.log(`[BatchFetch] Order ${order._id} - message from ${msg.sender}: ${msg.message.substring(0, 80)}...`);

        let otpFound = null;
        const cleanMessage = normalizeToSingleLine(msg.message);
        const otpRegexList = buildSmartOtpRegexList(order.formate);

        for (const regex of otpRegexList) {
          const m = regex.exec(cleanMessage);
          otpFound = m?.groups?.otp || (m && m[1]) || null;
          if (otpFound) {
            console.log(`[BatchFetch] Order ${order._id} - extracted OTP via format regex`);
            break;
          }
        }

        if (otpFound) {
          otpsFound++;

          // Build update for this order
          const updateFields = {
            updatedAt: new Date(),
            nextsms: false,
          };

          // First OTP = success
          if (order.message.length === 0) {
            updateFields.isused = true;
            updateFields.failureReason = 'none';
            updateFields.qualityImpact = 5;

            // Record number state snapshot
            const numDoc = await Numbers.findOne({ number: order.number });
            updateFields.numberSnapshot = {
              qualityScore: numDoc ? (numDoc.qualityScore || 100) : 100,
              consecutiveFailures: numDoc ? (numDoc.consecutiveFailures || 0) : 0,
              signal: 0
            };

            // Add to number quality updates
            numberQualityUpdates.push({
              number: order.number,
              impact: 5,
              reason: 'otp_received',
              orderId: order._id
            });

            // Add lock to create
            locksToCreate.push({
              number: order.number,
              countryid: order.countryid,
              serviceid: order.serviceid,
              locked: true,
            });

            console.log(`[BatchFetch] Order ${order._id} - first OTP received -> marking as used + creating lock`);
          }

          orderUpdates.push({
            updateOne: {
              filter: { _id: order._id },
              update: {
                $set: updateFields,
                $addToSet: { message: msg.message },
              }
            }
          });

          console.log(`[BatchFetch] Order ${order._id} - saved OTP: ${otpFound}`);
          break;
        } else {
          console.log(`[BatchFetch] Order ${order._id} - no OTP found (formats didn't match)`);
        }
      }
    }

    // === EXECUTE ALL UPDATES IN BATCH ===

    console.log(`[BatchFetch] ==========================================`);
    console.log(`[BatchFetch] Executing ${orderUpdates.length} order updates (batch)`);

    if (orderUpdates.length > 0) {
      const updateResult = await Orders.bulkWrite(orderUpdates, { ordered: false });
      console.log(`[BatchFetch] Bulk update result: matched=${updateResult.matchedCount}, modified=${updateResult.modifiedCount}`);
    }

    // Update number qualities
    console.log(`[BatchFetch] Updating ${numberQualityUpdates.length} number qualities`);
    for (const update of numberQualityUpdates) {
      await updateNumberQuality(update.number, update.impact, update.reason, update.orderId);
    }

    // Create locks
    console.log(`[BatchFetch] Creating ${locksToCreate.length} locks`);
    if (locksToCreate.length > 0) {
      await Lock.insertMany(locksToCreate);
    }

    console.log(`[BatchFetch] ==========================================`);
    console.log(`[BatchFetch] Job completed - processed: ${processed}, otpsFound: ${otpsFound}`);

    return {
      success: true,
      processed,
      errors,
      duration: Date.now() - startTime,
      details: {
        activeOrders: activeOrders.length,
        otpsFound,
        messagesFetched: allRecentMessages.length,
        updatesExecuted: orderUpdates.length,
      },
    };
  } catch (error) {
    errors++;
    console.error('[BatchFetch] Error:', error.message);
    return {
      success: false,
      processed,
      errors,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}

// Main execution
(async () => {
  try {
    await connectDB();

    console.log('\n===========================================');
    console.log('  BATCH FETCH TEST - NOT PRODUCTION');
    console.log('===========================================\n');

    const result = await testBatchFetchJob();

    console.log('\n===========================================');
    console.log('           TEST RESULT SUMMARY');
    console.log('===========================================');
    console.log(`Success: ${result.success}`);
    console.log(`Processed: ${result.processed} orders`);
    console.log(`OTPs Found: ${result.details?.otpsFound || 0}`);
    console.log(`Messages Fetched: ${result.details?.messagesFetched || 0}`);
    console.log(`Updates Executed: ${result.details?.updatesExecuted || 0}`);
    console.log(`Duration: ${result.duration}ms`);
    console.log(`Errors: ${result.errors}`);

    process.exit(result.success ? 0 : 1);

  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
})();
