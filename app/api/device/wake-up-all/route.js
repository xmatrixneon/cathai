import { NextResponse } from 'next/server';
import Device from '@/models/Device';
import { sendWakeUpNotification } from '@/lib/fcm/send.js';
import connectDB from '@/lib/db';

// TODO: Add authentication middleware to protect bulk wake-up API endpoint
// Consider implementing proper authentication for device management operations

export async function POST(request) {
  try {
    console.log('[wake-up-all] Starting request');
    await connectDB();
    console.log('[wake-up-all] DB connected');

    // Find all offline devices with FCM tokens
    console.log('[wake-up-all] Querying for offline devices...');
    const offlineDevices = await Device.find({
      status: 'offline',
      fcmToken: { $ne: null, $ne: '' }
    });
    console.log('[wake-up-all] Found', offlineDevices.length, 'offline devices');

    if (offlineDevices.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No offline devices with FCM tokens found',
        results: {
          total: 0,
          sent: 0,
          failed: 0
        }
      });
    }

    let successCount = 0;
    let failCount = 0;
    const results = [];

    // Send wake-up in batches (parallel processing)
    const batchSize = 50; // Process 50 devices at a time
    console.log(`[wake-up-all] Starting parallel batch processing (batch size: ${batchSize})`);

    for (let i = 0; i < offlineDevices.length; i += batchSize) {
      const batch = offlineDevices.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(offlineDevices.length / batchSize);

      console.log(`[wake-up-all] Batch ${batchNumber}/${totalBatches}: Processing ${batch.length} devices...`);

      // Process batch in parallel
      const batchResults = await Promise.all(
        batch.map(async (device) => {
          const result = await sendWakeUpNotification(device.deviceId, device.fcmToken);
          // Clean up stale tokens
          if (!result.success && result.isStaleToken) {
            await Device.updateOne(
              { deviceId: device.deviceId },
              { $unset: { fcmToken: '', fcmTokenUpdatedAt: '' } }
            );
          }
          return {
            deviceId: device.deviceId,
            name: device.name,
            success: result.success,
            isStaleToken: result.isStaleToken
          };
        })
      );

      // Count results
      batchResults.forEach(result => {
        results.push(result);
        if (result.success) {
          successCount++;
        } else {
          failCount++;
        }
      });

      console.log(`[wake-up-all] Batch ${batchNumber}/${totalBatches} complete: ${batchResults.filter(r => r.success).length} success, ${batchResults.filter(r => !r.success).length} failed`);
    }

    console.log('[wake-up-all] All batches completed');

    return NextResponse.json({
      success: true,
      message: `Wake-up sent to ${successCount} device(s), ${failCount} failed`,
      results: {
        total: offlineDevices.length,
        sent: successCount,
        failed: failCount
      },
      details: results
    });

  } catch (error) {
    console.error('Error in wake-up all API:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
