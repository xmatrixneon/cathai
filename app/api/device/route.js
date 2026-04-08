import connectDB from '@/lib/db';
import Device from '@/models/Device';
import { NextResponse } from 'next/server';
import { verify } from '@/lib/verify';

export async function GET(request) {
  try {
    // Authenticate request
    const authResult = await verify(request, { requireAdmin: true });
    if (!authResult.success) {
      return NextResponse.json(
        { success: false, error: authResult.error },
        { status: authResult.status }
      );
    }

    await connectDB();

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '100');
    const status = searchParams.get('status');
    const isActive = searchParams.get('isActive');

    let query = {};

    if (status) {
      query.status = status;
    }

    if (isActive !== null) {
      query.isActive = isActive === 'true';
    }

    const devices = await Device.find(query)
      .sort({ lastSeen: -1 })
      .limit(limit)
      .select('-__v -apiKey');

    const totalDevices = await Device.countDocuments(query);
    const onlineDevices = await Device.countDocuments({ ...query, status: 'online' });
    const offlineDevices = await Device.countDocuments({ ...query, status: 'offline' });

    return NextResponse.json({
      success: true,
      data: devices,
      meta: {
        total: totalDevices,
        online: onlineDevices,
        offline: offlineDevices
      }
    });

  } catch (error) {
    console.error('Error fetching devices:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
