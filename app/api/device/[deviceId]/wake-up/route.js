/**
 * Wake-Up API Endpoint
 *
 * POST /api/device/:deviceId/wake-up
 *
 * Manually trigger an FCM wake-up notification to a device.
 * This is useful when a device has gone offline and needs to be remotely woken up.
 *
 * The endpoint will:
 * 1. Check if the device exists
 * 2. Check if the device has an FCM token
 * 3. Send a high-priority wake-up notification via FCM
 * 4. Return success/failure status
 */

import { NextResponse } from 'next/server';
import Device from '@/models/Device';
import { sendWakeUpNotification } from '@/lib/fcm/send.js';

export async function POST(request, { params }) {
  try {
    // Await params as required by Next.js 15
    const { deviceId } = await params;

    if (!deviceId) {
      return NextResponse.json(
        { success: false, error: 'Device ID is required' },
        { status: 400 }
      );
    }

    // Find the device
    const device = await Device.findOne({ deviceId });

    if (!device) {
      return NextResponse.json(
        { success: false, error: 'Device not found' },
        { status: 404 }
      );
    }

    // Check if device has FCM token
    if (!device.fcmToken) {
      return NextResponse.json(
        {
          success: false,
          error: 'Device does not have an FCM token',
          deviceId,
          deviceStatus: device.status
        },
        { status: 400 }
      );
    }

    // Send wake-up notification
    const success = await sendWakeUpNotification(deviceId, device.fcmToken);

    if (success) {
      return NextResponse.json({
        success: true,
        message: 'Wake-up notification sent successfully',
        deviceId,
        deviceStatus: device.status,
        sentAt: new Date().toISOString()
      });
    } else {
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to send wake-up notification',
          deviceId,
          deviceStatus: device.status
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error in wake-up API:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
