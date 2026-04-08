import connectDB from '@/lib/db';
import Device from '@/models/Device';
import Message from '@/models/Message';
import { NextResponse } from 'next/server';

// TODO: Add authentication middleware to protect device list API endpoint
// Consider implementing proper authentication for device management operations

export async function GET(request) {
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const sortBy = searchParams.get('sortBy') || 'lastSeen';
    const sortOrder = searchParams.get('sortOrder') === 'asc' ? 1 : -1;
    const status = searchParams.get('status');
    const search = searchParams.get('search');

    let query = { isActive: true };  // Only show active devices
    if (status && status !== 'all') query.status = status;
    if (search) {
      query.$and = [
        { isActive: true },
        ...(status && status !== 'all' ? [{ status }] : []),
        { $or: [
          { name: { $regex: search, $options: 'i' } },
          { deviceId: { $regex: search, $options: 'i' } }
        ]}
      ];
      // Remove status from top level since it's now in $and
      delete query.status;
    }

    const total = await Device.countDocuments(query);
    const pages = Math.ceil(total / limit);

    const rawDevices = await Device.find(query)
      .sort({ [sortBy]: sortOrder })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('-__v -apiKey')
      .lean(); // Performance optimization: use lean() for read-only queries

    const now = new Date();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // FIX N+1 query: Single aggregation to count messages for all devices at once
    const deviceIds = rawDevices.map(d => d.deviceId);
    const messageCounts = await Message.aggregate([
      {
        $match: {
          'metadata.deviceId': { $in: deviceIds },
          time: { $gte: today }
        }
      },
      {
        $group: {
          _id: '$metadata.deviceId',
          count: { $sum: 1 }
        }
      }
    ]);

    // Create a map for O(1) lookup of message counts
    const messageCountMap = new Map(messageCounts.map(m => [m._id, m.count]));

    // Enrich each device with recentMessages and timeSinceLastSeen
    const devices = rawDevices.map((device) => {
      const recentMessages = messageCountMap.get(device.deviceId) || 0;

      const lastSeen = new Date(device.lastSeen);
      const diffMs = now - lastSeen;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      return {
        ...device,
        recentMessages,
        timeSinceLastSeen: {
          minutes: diffMins % 60,
          hours: diffHours % 24,
          days: diffDays
        }
      };
    });

    // Stats - parallelize all count queries for better performance
    const baseQuery = { isActive: true };
    const [online, offline, error, totalMessages] = await Promise.all([
      Device.countDocuments({ ...baseQuery, status: 'online' }),
      Device.countDocuments({ ...baseQuery, status: 'offline' }),
      Device.countDocuments({ ...baseQuery, status: 'error' }),
      Message.countDocuments({ time: { $gte: today } })
    ]);

    return NextResponse.json({
      success: true,
      data: {
        devices,
        stats: { total, online, offline, error, totalMessages },
        pagination: { page, pages, limit, total }
      }
    });
  } catch (error) {
    console.error('Error fetching devices:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
