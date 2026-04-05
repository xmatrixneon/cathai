import { NextResponse } from 'next/server';
import Device from '@/models/Device';
import { sendWakeUpNotification } from '@/lib/fcm/send.js';
import connectDB from '@/lib/db';

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

    // Send wake-up to each device
    console.log('[wake-up-all] Starting to send notifications to', offlineDevices.length, 'devices');
    for (let i = 0; i < offlineDevices.length; i++) {
      const device = offlineDevices[i];
      if (i % 10 === 0) {
        console.log(`[wake-up-all] Progress: ${i}/${offlineDevices.length} devices processed`);
      }
      const success = await sendWakeUpNotification(device.deviceId, device.fcmToken);
      results.push({
        deviceId: device.deviceId,
        name: device.name,
        success
      });
      if (success) {
        successCount++;
      } else {
        failCount++;
      }
    }
    console.log('[wake-up-all] Completed sending notifications');

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
