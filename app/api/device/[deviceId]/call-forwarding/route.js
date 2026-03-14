import connectDB from '@/lib/db';
import Device from '@/models/Device';
import { NextResponse } from 'next/server';

// Get WebSocket manager - direct import
let wsManager = null;
if (typeof window !== 'undefined') {
  // Client-side - can't access server wsManager
} else {
  // Server-side - get from global
  try {
    // Access the global wsManager that's set by server.js
    wsManager = global.wsManager;
  } catch (e) {
    console.error('Failed to access wsManager:', e);
  }
}

// Helper function to safely get wsManager instance
const getWsManagerSafe = () => {
  if (!wsManager) {
    if (typeof window !== 'undefined') {
      return null;
    }
    try {
      wsManager = global.wsManager;
    } catch (e) {
      console.error('Failed to get wsManager:', e);
    }
  }
  return wsManager;
};

/**
 * POST /api/device/[deviceId]/call-forwarding
 *
 * Send a call forwarding command to a device
 *
 * Request body:
 * {
 *   action: "forward" | "deactivate" | "check",
 *   phoneNumber: string (required for "forward" action),
 *   simSlot: number (optional, default: 0)
 * }
 */
export async function POST(request, { params }) {
  try {
    await connectDB();

    // Await params to avoid Next.js warning
    const { deviceId } = await params;

    const body = await request.json();

    const { action, phoneNumber, simSlot = 0 } = body;

    // Validate device exists
    const device = await Device.findOne({ deviceId });
    if (!device) {
      return NextResponse.json(
        { success: false, error: 'Device not found' },
        { status: 404 }
      );
    }

    // Validate device is online
    const wsMgr = getWsManagerSafe();
    if (!wsMgr || typeof wsMgr.isDeviceOnline !== 'function' || !wsMgr.isDeviceOnline(deviceId)) {
      return NextResponse.json(
        { success: false, error: 'Device is offline' },
        { status: 400 }
      );
    }

    // Validate action
    const validActions = ['forward', 'deactivate', 'check'];
    if (!validActions.includes(action)) {
      return NextResponse.json(
        { success: false, error: `Invalid action. Must be one of: ${validActions.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate phone number for forward action
    if (action === 'forward' && (!phoneNumber || typeof phoneNumber !== 'string')) {
      return NextResponse.json(
        { success: false, error: 'Phone number is required for forward action' },
        { status: 400 }
      );
    }

    // Validate SIM slot
    if (typeof simSlot !== 'number' || simSlot < 0 || simSlot > 1) {
      return NextResponse.json(
        { success: false, error: 'SIM slot must be 0 or 1' },
        { status: 400 }
      );
    }

    // Send command to device via WebSocket
    if (!wsMgr || typeof wsMgr.sendToDevice !== 'function') {
      return NextResponse.json(
        { success: false, error: 'WebSocket manager not available' },
        { status: 500 }
      );
    }

    const command = {
      type: 'call_forwarding',
      data: {
        action,
        phoneNumber: action === 'forward' ? phoneNumber : null,
        simSlot
      }
    };

    const sent = wsMgr.sendToDevice(deviceId, command);

    if (!sent) {
      return NextResponse.json(
        { success: false, error: 'Failed to send command to device' },
        { status: 500 }
      );
    }

    console.log(`📞 Call forwarding command sent to ${deviceId}: action=${action}, simSlot=${simSlot}`);

    return NextResponse.json({
      success: true,
      message: 'Call forwarding command sent to device',
      data: {
        deviceId,
        action,
        simSlot,
        phoneNumber: action === 'forward' ? phoneNumber : null,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error sending call forwarding command:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
