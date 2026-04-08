// jobs/handlers/fetch-handler.js
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
    console.warn(`      [Fetch] Number ${number} not found for quality update`);
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

  console.log(`      [Fetch] Quality ${number}: ${newQualityScore} (${impact > 0 ? '+' : ''}${impact})`);
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

      // 1. Expire after 15 min
      if (ageMinutes > 15) {
        let failureReason;
        let qualityImpact;

        if (order.message.length === 0) {
          // No SMS received at all - likely no recharge/balance
          failureReason = 'expired_no_recharge';
          qualityImpact = -15;
        } else {
          // Some messages received - network issues or delayed OTP
          failureReason = 'expired_no_sms';
          qualityImpact = 0;
        }

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

        console.log(`[Fetch] Order ${order._id} expired (${ageMinutes.toFixed(1)}min) - ${failureReason}`);
        continue;
      }

      const messageLength = order.message.length;

      // 2. Check message limit
      if (order.maxmessage !== 0 && messageLength >= order.maxmessage) {
        console.log(`[Fetch] Order ${order._id} - message limit reached (${messageLength}/${order.maxmessage})`);
        continue;
      }

      // 3. Handle both old and new number formats for backward compatibility
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

      console.log(`[Fetch] Order ${order._id} — number: ${order.number} (full: ${fullNumber})`);

      const escapedFullNumber = escapeRegex(fullNumber);
      const escapedNumberOnly = escapeRegex(orderNumberStr);
      const escapedNumberWithCountry = escapeRegex(numberWithCountry);

      // Build regex list from templates
      const otpRegexList = buildSmartOtpRegexList(order.formate);

      // Base time = order createdAt (never changes, unlike updatedAt)
      const baseTime = order.createdAt;

      // Look back 3 minutes to catch any delayed messages
      const sinceTime = new Date(baseTime.getTime() - 180000);

      // Time filter
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

      console.log(`[Fetch] Order ${order._id} - matched messages (exact): ${messages.length}`);

      // PARTIAL MATCH FALLBACK: If no messages found, try matching last 10 digits
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
          console.log(`[Fetch] Order ${order._id} - matched messages (partial): ${messages.length} - using last 10 digits: ${last10Digits}`);
        }
      }

      // 4. Multi-use logic
      if (order.message.length > 0) {
        if (!order.ismultiuse) {
          console.log(`[Fetch] Order ${order._id} - already has OTP, multiuse=false → skip`);
          continue;
        }
        if (!order.nextsms) {
          console.log(`[Fetch] Order ${order._id} - multiuse enabled but nextsms=false → wait`);
          continue;
        }
      }

      for (const msg of messages) {
        // Skip if already saved
        if (order.message.includes(msg.message)) {
          console.log(`[Fetch] Order ${order._id} - message already saved, skipping`);
          continue;
        }

        if (!containsKeywords(msg.message, order.keywords)) {
          console.log(`[Fetch] Order ${order._id} - skipped (keywords not matched)`);
          continue;
        }

        console.log(`[Fetch] Order ${order._id} - message from ${msg.sender}: ${msg.message.substring(0, 80)}...`);

        let otpFound = null;

        // Normalize message to single line
        const cleanMessage = normalizeToSingleLine(msg.message);

        for (const regex of otpRegexList) {
          const m = regex.exec(cleanMessage);
          otpFound = m?.groups?.otp || (m && m[1]) || null;
          if (otpFound) {
            console.log(`[Fetch] Order ${order._id} - extracted OTP via format regex`);
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
            console.log(`[Fetch] Order ${order._id} - first OTP received → marking as used + creating lock`);
          }

          await Orders.updateOne(
            { _id: order._id },
            {
              $set: updateFields,
              $addToSet: { message: msg.message },
            }
          );

          console.log(`[Fetch] Order ${order._id} - saved OTP: ${otpFound}`);
          break; // save only one OTP per run
        } else {
          console.log(`[Fetch] Order ${order._id} - no OTP found (formats didn't match)`);
        }
      }
    }

    console.log(`[Fetch] Job completed - processed: ${processed}, otpsFound: ${otpsFound}`);

    // Update CronStatus for dashboard display
    try {
      await CronStatus.findOneAndUpdate(
        { name: 'fetchOrders' },
        { lastRun: new Date() },
        { upsert: true }
      );
      console.log('[Fetch] CronStatus updated');
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
