// jobs/handlers/suspend-handler.js
import Numbers from '../../models/Numbers.js';
import Orders from '../../models/Orders.js';

export async function handleSuspendJob(data) {
  const startTime = Date.now();
  let processed = 0;
  let errors = 0;
  let suspended = 0;
  let recovered = 0;

  try {
    const { type = 'suspend-check', threshold = 0, windowHours = 12, testNumber = null, dryRun = false } = data;

    const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000);

    if (type === 'suspend-check') {
      // Suspend check
      console.log(`[Suspend] Running suspend check (threshold=${threshold}, window=${windowHours}h, dryRun=${dryRun})`);

      const query = {
        suspended: { $ne: true },
        active: true,
      };

      if (testNumber) {
        query.number = testNumber;
      }

      const numbers = await Numbers.find(query);

      for (const number of numbers) {
        processed++;

        const orderCount = await Orders.countDocuments({
          number: number.number,
          createdAt: { $gte: windowStart },
        });

        if (orderCount >= threshold && threshold > 0) {
          const smsCount = await Orders.countDocuments({
            number: number.number,
            createdAt: { $gte: windowStart },
            'message.0': { $exists: true },
          });

          if (smsCount === 0) {
            if (!dryRun) {
              await Numbers.updateOne(
                { _id: number._id },
                {
                  $set: {
                    suspended: true,
                    suspensionReason: 'low_sms',
                    suspendedAt: new Date(),
                    lowSmsSuspensionCount: (number.lowSmsSuspensionCount || 0) + 1,
                    lastLowSmsCheck: new Date(),
                    smsReceivedInWindow: smsCount,
                  },
                }
              );
            }
            suspended++;
            console.log(`[Suspend] Suspended ${number.number} (${orderCount} orders, ${smsCount} SMS)`);
          } else {
            await Numbers.updateOne(
              { _id: number._id },
              { $set: { lastLowSmsCheck: new Date(), smsReceivedInWindow: smsCount } }
            );
          }
        }
      }
    } else if (type === 'recovery-check') {
      // Recovery check
      console.log(`[Suspend] Running recovery check (dryRun=${dryRun})`);

      const query = {
        suspended: true,
        suspensionReason: 'low_sms',
        active: true,
      };

      if (testNumber) {
        query.number = testNumber;
      }

      const suspendedNumbers = await Numbers.find(query);

      for (const number of suspendedNumbers) {
        processed++;

        const smsCount = await Orders.countDocuments({
          number: number.number,
          createdAt: { $gte: windowStart },
          'message.0': { $exists: true },
        });

        if (smsCount > 0) {
          if (!dryRun) {
            await Numbers.updateOne(
              { _id: number._id },
              {
                $set: {
                  suspended: false,
                  suspensionReason: 'none',
                  lowSmsSuspensionCount: 0,
                },
                $unset: { suspendedAt: '' },
              }
            );
          }
          recovered++;
          console.log(`[Suspend] Recovered ${number.number} (${smsCount} SMS received)`);
        }
      }
    }

    return {
      success: true,
      processed,
      errors,
      duration: Date.now() - startTime,
      details: {
        type,
        threshold,
        windowHours,
        suspended,
        recovered,
        dryRun,
      },
    };
  } catch (error) {
    errors++;
    return {
      success: false,
      processed,
      errors,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}
