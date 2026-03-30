import { NextResponse } from 'next/server';
import Device from '@/models/Device';
import { sendWakeUpNotification } from '@/lib/fcm/send.js';
import connectDB from '@/lib/db';

export async function POST(request) {
  try {
    await connectDB();

    // Find all offline devices with FCM tokens
    const offlineDevices = await Device.find({
      status: 'offline',
      fcmToken: { $ne: null, $ne: '' }
    });

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
    for (const device of offlineDevices) {
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
