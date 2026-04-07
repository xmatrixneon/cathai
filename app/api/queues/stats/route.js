import { NextResponse } from 'next/server';
import { getAllQueues } from '@/lib/queues';

export async function GET() {
  try {
    const queues = await getAllQueues();
    const stats = [];

    for (const queue of queues) {
      const counts = await queue.getJobCounts();
      stats.push({
        name: queue.name,
        waiting: counts.waiting || 0,
        active: counts.active || 0,
        completed: counts.completed || 0,
        failed: counts.failed || 0,
        delayed: counts.delayed || 0,
      });
    }

    // Get Redis connection info
    const { getRedis } = await import('@/lib/queues/redis.js');
    const redis = getRedis();
    const redisInfo = {
      connected: redis.status === 'ready',
      host: redis.options.host || 'localhost',
      port: redis.options.port || 6379,
    };

    return NextResponse.json({
      queues: stats,
      redis: redisInfo,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Queue Stats] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch queue stats', message: error.message },
      { status: 500 }
    );
  }
}
