import { NextResponse } from 'next/server';
import { getAllQueues } from '@/lib/queues';

// GET - List failed jobs from all queues
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') || '10');

    const queues = await getAllQueues();
    const failedJobs = {};

    for (const { name, queue } of queues) {
      const failed = await queue.getFailed(0, limit);
      failedJobs[name] = failed.map(job => ({
        id: job.id,
        name: job.name,
        data: job.data,
        failedReason: job.failedReason,
        attemptsMade: job.attemptsMade,
        processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : null,
        failedOn: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
      }));
    }

    return NextResponse.json({
      failedJobs,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[DLQ] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch failed jobs', message: error.message },
      { status: 500 }
    );
  }
}

// POST - Retry a failed job
export async function POST(req) {
  try {
    const { queue, jobId } = await req.json();

    if (!queue || !jobId) {
      return NextResponse.json(
        { error: 'Missing required fields: queue, jobId' },
        { status: 400 }
      );
    }

    const queues = await getAllQueues();
    const targetQueue = queues.find(q => q.name === queue)?.queue;

    if (!targetQueue) {
      return NextResponse.json(
        { error: `Queue "${queue}" not found` },
        { status: 404 }
      );
    }

    const job = await targetQueue.getJob(jobId);

    if (!job) {
      return NextResponse.json(
        { error: `Job "${jobId}" not found in queue "${queue}"` },
        { status: 404 }
      );
    }

    // Retry the job
    await job.retry();

    return NextResponse.json({
      success: true,
      message: `Job ${jobId} queued for retry`,
      queue,
      jobId,
    });
  } catch (error) {
    console.error('[DLQ] Error:', error);
    return NextResponse.json(
      { error: 'Failed to retry job', message: error.message },
      { status: 500 }
    );
  }
}

// DELETE - Remove a failed job
export async function DELETE(req) {
  try {
    const { searchParams } = new URL(req.url);
    const queue = searchParams.get('queue');
    const jobId = searchParams.get('jobId');

    if (!queue || !jobId) {
      return NextResponse.json(
        { error: 'Missing required query params: queue, jobId' },
        { status: 400 }
      );
    }

    const queues = await getAllQueues();
    const targetQueue = queues.find(q => q.name === queue)?.queue;

    if (!targetQueue) {
      return NextResponse.json(
        { error: `Queue "${queue}" not found` },
        { status: 404 }
      );
    }

    const job = await targetQueue.getJob(jobId);

    if (!job) {
      return NextResponse.json(
        { error: `Job "${jobId}" not found in queue "${queue}"` },
        { status: 404 }
      );
    }

    // Remove the job
    await job.remove();

    return NextResponse.json({
      success: true,
      message: `Job ${jobId} removed from queue`,
      queue,
      jobId,
    });
  } catch (error) {
    console.error('[DLQ] Error:', error);
    return NextResponse.json(
      { error: 'Failed to remove job', message: error.message },
      { status: 500 }
    );
  }
}
