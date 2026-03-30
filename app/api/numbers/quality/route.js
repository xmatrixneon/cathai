import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import Numbers from '@/models/Numbers.js';

// MongoDB connection check
async function ensureConnection() {
  if (!mongoose.connection.readyState) {
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  }
}

// GET - Fetch numbers with quality data
export async function GET(request) {
  try {
    await ensureConnection();

    const { searchParams } = new URL(request.url);
    const filter = searchParams.get('filter') || 'all';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const search = searchParams.get('search') || '';
    const skip = (page - 1) * limit;

    // Build query based on filter
    let query = {};
    switch (filter) {
      case 'suspended':
        query = { suspended: true };
        break;
      case 'warning':
        query = { qualityScore: { $lt: 50, $gte: 30 }, suspended: false };
        break;
      case 'active':
        query = { active: true, suspended: false };
        break;
      case 'all':
      default:
        query = {};
    }

    // Add search filter if provided
    // Note: number field is numeric, so we need special handling
    let numbers, total;

    if (search && /^\d+$/.test(search)) {
      // Search is all digits - do exact number match
      query.number = parseInt(search);
      [numbers, total] = await Promise.all([
        Numbers.find(query)
          .sort({ qualityScore: 1, updatedAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Numbers.countDocuments(query)
      ]);
    } else if (search) {
      // Search contains non-digits - use aggregation to convert number to string
      const pipeline = [
        { $match: query },
        {
          $addFields: {
            numberAsString: { $toString: '$number' }
          }
        },
        {
          $match: {
            numberAsString: { $regex: search, $options: 'i' }
          }
        },
        { $sort: { qualityScore: 1, updatedAt: -1 } },
        { $skip: skip },
        { $limit: limit }
      ];

      const countPipeline = [
        { $match: query },
        {
          $addFields: {
            numberAsString: { $toString: '$number' }
          }
        },
        {
          $match: {
            numberAsString: { $regex: search, $options: 'i' }
          }
        },
        {
          $count: 'total'
        }
      ];

      [numbers, [countResult]] = await Promise.all([
        Numbers.aggregate(pipeline),
        Numbers.aggregate(countPipeline)
      ]);
      total = countResult?.total || 0;
    } else {
      // No search - use normal query
      [numbers, total] = await Promise.all([
        Numbers.find(query)
          .sort({ qualityScore: 1, updatedAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Numbers.countDocuments(query)
      ]);
    }

    const [globalStats] = await Numbers.aggregate([
      {
        $group: {
          _id: null,
          totalCount: { $sum: 1 },
          activeCount: {
            $sum: {
              $cond: [{ $eq: ['$active', true] }, 1, 0]
            }
          },
          suspendedCount: {
            $sum: {
              $cond: [{ $eq: ['$suspended', true] }, 1, 0]
            }
          },
          avgQuality: { $avg: '$qualityScore' }
        }
      }
    ]);

    return NextResponse.json({
      success: true,
      data: numbers,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      },
      stats: globalStats || {
        totalCount: 0,
        activeCount: 0,
        suspendedCount: 0,
        avgQuality: 0
      }
    });

  } catch (error) {
    console.error('Error fetching quality data:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}

// POST - Bulk actions (suspend, recover, reset)
export async function POST(request) {
  try {
    await ensureConnection();
    const body = await request.json();
    const { action, numbers, reason } = body;

    if (!action || !numbers || !Array.isArray(numbers)) {
      return NextResponse.json({
        success: false,
        error: 'Missing required fields: action, numbers'
      }, { status: 400 });
    }

    let updateFields = {};
    let result;

    switch (action) {
      case 'suspend':
        updateFields = {
          suspended: true,
          suspensionReason: reason || 'manual',
          suspendedAt: new Date()
        };
        result = await Numbers.updateMany(
          { number: { $in: numbers } },
          { $set: updateFields }
        );
        break;

      case 'recover':
        updateFields = {
          suspended: false,
          suspensionReason: 'none',
          suspendedAt: null,
          consecutiveFailures: 0
        };
        result = await Numbers.updateMany(
          { number: { $in: numbers } },
          { $set: updateFields }
        );
        break;

      case 'reset':
        updateFields = {
          qualityScore: 100,
          suspended: false,
          suspensionReason: 'none',
          suspendedAt: null,
          consecutiveFailures: 0,
          failureCount: 0,
          successCount: 0,
          lastFailureAt: null,
          lastSuccessAt: null
        };
        result = await Numbers.updateMany(
          { number: { $in: numbers } },
          { $set: updateFields }
        );
        break;

      default:
        return NextResponse.json({
          success: false,
          error: 'Invalid action. Use: suspend, recover, or reset'
        }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: `Successfully ${action}ed ${result.modifiedCount} numbers`,
      modifiedCount: result.modifiedCount
    });

  } catch (error) {
    console.error('Error performing bulk action:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}

// PUT - Update single number quality
export async function PUT(request) {
  try {
    await ensureConnection();
    const body = await request.json();
    const { number, qualityScore, suspended, suspensionReason } = body;

    if (!number) {
      return NextResponse.json({
        success: false,
        error: 'Number is required'
      }, { status: 400 });
    }

    const updateFields = {};
    if (qualityScore !== undefined) updateFields.qualityScore = Math.max(0, Math.min(100, qualityScore));
    if (suspended !== undefined) {
      updateFields.suspended = suspended;
      updateFields.suspensionReason = suspended ? (suspensionReason || 'manual') : 'none';
      updateFields.suspendedAt = suspended ? new Date() : null;
    }

    const result = await Numbers.findOneAndUpdate(
      { number },
      { $set: updateFields },
      { new: true }
    );

    if (!result) {
      return NextResponse.json({
        success: false,
        error: 'Number not found'
      }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Error updating number:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}

// DELETE - Delete number (soft delete - set active: false)
export async function DELETE(request) {
  try {
    await ensureConnection();
    const { searchParams } = new URL(request.url);
    const number = searchParams.get('number');

    if (!number) {
      return NextResponse.json({
        success: false,
        error: 'Number parameter is required'
      }, { status: 400 });
    }

    const result = await Numbers.findOneAndUpdate(
      { number },
      { $set: { active: false } },
      { new: true }
    );

    if (!result) {
      return NextResponse.json({
        success: false,
        error: 'Number not found'
      }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: 'Number deactivated successfully'
    });

  } catch (error) {
    console.error('Error deactivating number:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
