// jobs/handlers/fetch-handler.js - BATCH OPTIMIZED VERSION
// Preserves ALL original functionality, only changes message fetching to batch approach
import mongoose from 'mongoose';
import Orders from '../../models/Orders.js';
import Message from '../../models/Message.js';
import Numbers from '../../models/Numbers.js';
import Lock from '../../models/Lock.js';
import CronStatus from '../../models/Cron.js';

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
      if (!format.includes("{otp")) return null;

      let pattern = escapeRegex(format);

      let isFirstOtp = true;

      // Handle {otp5} - exactly 5 digits
      if (format.includes("{otp5}")) {
        pattern = pattern.replace(/\\\{otp5\\\}/gi, () => {
          if (isFirstOtp) {
            isFirstOtp = false;
            return "(?<otp>\\d{5})";
          }
          return "(?:\\d{5})";
        });
      } else {
        // Handle {otp} - 3-12 characters (original behavior)
        pattern = pattern.replace(/\\\{otp\\\}/gi, () => {
          if (isFirstOtp) {
            isFirstOtp = false;
            return "(?<otp>[A-Za-z0-9\\-]{3,12})";
          }
          return "(?:[A-Za-z0-9\\-]{3,12})";
        });
      }

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
    // console.warn(`      [Fetch] Number ${number} not found for quality update`);
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
  } else {
    newFailureCount++;
    newConsecutiveFailures++;
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

  // console.log(`      [Fetch] Quality ${number}: ${newQualityScore} (${impact > 0 ? '+' : ''}${impact})`);
}

export async function handleFetchJob(data) {
  const startTime = Date.now();
  let processed = 0;
  let errors = 0;
  let otpsFound = 0;

  try {
    console.log('[Fetch] Starting OTP fetch job (BATCH OPTIMIZED)');

    // === BATCH APPROACH: Get all recent messages FIRST ===
    const activeOrders = await Orders.find({ active: true });
    console.log(`[Fetch] Found ${activeOrders.length} active orders`);

    if (activeOrders.length === 0) {
      console.log('[Fetch] No active orders to process');
      return { success: true, processed: 0, errors: 0, duration: 0 };
    }

    // Find the oldest order creation time to set the query window
    const minCreatedAt = activeOrders.reduce((min, order) =>
      order.createdAt < min ? order.createdAt : min, activeOrders[0].createdAt);

    // Look back 3 minutes from the oldest order
    const sinceTime = new Date(minCreatedAt.getTime() - 180000);

    console.log(`[Fetch] Fetching all messages since ${sinceTime.toISOString()} (BATCH QUERY)`);

    // === ONE QUERY to get all recent messages ===
    const allRecentMessages = await Message.find({
      time: { $gte: sinceTime }
    }).sort({ createdAt: 1 });

    console.log(`[Fetch] Fetched ${allRecentMessages.length} total recent messages in 1 query`);

    // === Group messages by receiver number for fast in-memory lookup ===
    const messagesByReceiver = new Map();

    for (const msg of allRecentMessages) {
      const receiver = msg.receiver || "";
      if (!messagesByReceiver.has(receiver)) {
        messagesByReceiver.set(receiver, []);
      }
      messagesByReceiver.get(receiver).push(msg);
    }

    console.log(`[Fetch] Grouped into ${messagesByReceiver.size} unique receiver numbers`);

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
        // Determine failure reason and quality impact
        let failureReason;
        let qualityImpact;

        if (order.isused === true) {
          // Already received OTP successfully - preserve success state
          failureReason = order.failureReason || 'none';
          qualityImpact = order.qualityImpact || 5;
        } else if (order.message.length === 0) {
          // No SMS received at all - likely no recharge/balance
          failureReason = 'expired_no_recharge';
          qualityImpact = -15;
        } else {
          // Some messages received - network issues or delayed OTP
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

        // Update number quality ONLY if no-recharge failure
        if (qualityImpact !== 0 && order.isused !== true) {
          await updateNumberQuality(order.number, qualityImpact, failureReason, order._id);
        }

        // console.log(`[Fetch] Order ${order._id} expired (${ageMinutes.toFixed(1)}min) - ${failureReason}`);
        continue;
      }

      const messageLength = order.message.length;

      // 2. Check message limit
      if (order.maxmessage !== 0 && messageLength >= order.maxmessage) {
        // console.log(`[Fetch] Order ${order._id} - message limit reached (${messageLength}/${order.maxmessage})`);
        continue;
      }

      // 3. Find messages for this order (from in-memory map - NO DB QUERY!)
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

      // console.log(`[Fetch] Order ${order._id} — number: ${order.number} (full: ${fullNumber})`);

      // Look up messages from the grouped map (NO DB QUERY!)
      let messages = [];

      // Try exact receiver match first
      const exactMatches = messagesByReceiver.get(fullNumber) ||
                         messagesByReceiver.get(orderNumberStr.toString()) ||
                         messagesByReceiver.get(numberWithCountry);

      if (exactMatches) {
        // Filter messages within order's time window
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
          // console.log(`[Fetch] Order ${order._id} - matched messages (partial): ${messages.length} - using last 10 digits: ${orderNumberStr.slice(-10)}`);
        }
      } else if (messages.length > 0) {
        // console.log(`[Fetch] Order ${order._id} - matched messages (exact): ${messages.length}`);
      }

      // 4. Multi-use logic
      if (order.message.length > 0) {
        if (!order.ismultiuse) {
          // console.log(`[Fetch] Order ${order._id} - already has OTP, multiuse=false → skip`);
          continue;
        }
        if (!order.nextsms) {
          // console.log(`[Fetch] Order ${order._id} - multiuse enabled but nextsms=false → wait`);
          continue;
        }
      }

      for (const msg of messages) {
        // Skip if already saved
        if (order.message.includes(msg.message)) {
          // console.log(`[Fetch] Order ${order._id} - message already saved, skipping`);
          continue;
        }

        if (!containsKeywords(msg.message, order.keywords)) {
          // console.log(`[Fetch] Order ${order._id} - skipped (keywords not matched)`);
          continue;
        }

        // console.log(`[Fetch] Order ${order._id} - message from ${msg.sender}: ${msg.message.substring(0, 80)}...`);

        let otpFound = null;

        // Normalize message to single line
        const cleanMessage = normalizeToSingleLine(msg.message);

        // Build regex list from templates
        const otpRegexList = buildSmartOtpRegexList(order.formate);

        for (const regex of otpRegexList) {
          const m = regex.exec(cleanMessage);
          otpFound = m?.groups?.otp || (m && m[1]) || null;
          if (otpFound) {
            // console.log(`[Fetch] Order ${order._id} - extracted OTP via format regex`);
            break;
          }
        }

        if (otpFound) {
          otpsFound++;
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

            // Create lock
            const newLock = new Lock({
              number: order.number,
              countryid: order.countryid,
              serviceid: order.serviceid,
              locked: true,
            });

            await newLock.save();
            // console.log(`[Fetch] Order ${order._id} - first OTP received → marking as used + creating lock`);
          }

          await Orders.updateOne(
            { _id: order._id },
            {
              $set: updateFields,
              $addToSet: { message: msg.message }
            }
          );

          // console.log(`[Fetch] Order ${order._id} - saved OTP: ${otpFound}`);
          break; // save only one OTP per run
        } else {
          // console.log(`[Fetch] Order ${order._id} - no OTP found (formats didn't match)`);
        }
      }
    }

    // === EXECUTE ALL UPDATES IN BATCH ===
    // console.log(`[Fetch] Executing ${orderUpdates.length} order updates (BULK WRITE)`);

    if (orderUpdates.length > 0) {
      const updateResult = await Orders.bulkWrite(orderUpdates, { ordered: false });
      // console.log(`[Fetch] Bulk update result: matched=${updateResult.matchedCount}, modified=${updateResult.modifiedCount}`);
    }

    console.log(`[Fetch] Job completed - processed: ${processed}, otpsFound: ${otpsFound}`);

    // Update CronStatus for dashboard display
    try {
      await CronStatus.findOneAndUpdate(
        { name: 'fetchOrders' },
        { lastRun: new Date() },
        { upsert: true }
      );
      // console.log('[Fetch] CronStatus updated');
    } catch (cronErr) {
      console.error('[Fetch] Failed to update CronStatus:', cronErr.message);
    }

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
