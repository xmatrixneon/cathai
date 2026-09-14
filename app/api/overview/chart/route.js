// app/api/overview/chart/route.js
import { NextResponse } from "next/server";
import Orders from "@/models/Orders";
import dbConnect from "@/lib/db";
import { verify } from "@/lib/verify"

// Short-lived in-process cache - the 7-day aggregation scans 1.6M+ orders,
// re-running it on every dashboard load hammers MongoDB. A 5-minute window
// is invisible on a weekly chart and keeps cold loads rare.
const CHART_CACHE_TTL_MS = 5 * 60 * 1000;
let chartCache = { key: null, at: 0, data: null };

export async function GET(req) {
  try {
    await dbConnect();

    // 🔐 Verify request (verify() returns a result, it does not throw)
    const auth = await verify(req)
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
    }

    const todayKey = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const cacheKey = `dashboard:chart:7days:${todayKey}`;

    if (chartCache.key === cacheKey && Date.now() - chartCache.at < CHART_CACHE_TTL_MS) {
      return NextResponse.json(chartCache.data);
    }

    // Calculate IST start date for last 7 days
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffset);

    const sevenDaysAgoIST = new Date(istNow);
    sevenDaysAgoIST.setDate(sevenDaysAgoIST.getDate() - 6);
    sevenDaysAgoIST.setHours(0, 0, 0, 0);

    // Convert back to UTC for Mongo query
    const sevenDaysAgoUTC = new Date(sevenDaysAgoIST.getTime() - istOffset);

    const stats = await Orders.aggregate([
      {
        $match: {
          createdAt: { $gte: sevenDaysAgoUTC }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: { date: "$createdAt", timezone: "Asia/Kolkata" } },
            month: { $month: { date: "$createdAt", timezone: "Asia/Kolkata" } },
            day: { $dayOfMonth: { date: "$createdAt", timezone: "Asia/Kolkata" } }
          },
          totalSuccessOrders: {
            $sum: { $cond: [{ $eq: ["$isused", true] }, 1, 0] }
          },
          totalUnsuccessOrders: {
            $sum: { $cond: [{ $eq: ["$isused", false] }, 1, 0] }
          },
          usedNumbersSet: { $addToSet: "$number" }
        }
      },
      {
        $addFields: {
          usedNumbers: { $size: "$usedNumbersSet" }
        }
      },
      { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } }
    ]);

    const result = stats.map(item => {
      // Construct IST date
      const date = new Date(Date.UTC(item._id.year, item._id.month - 1, item._id.day));
      return {
        date: date.toISOString().split("T")[0], // YYYY-MM-DD
        totalSuccessOrders: item.totalSuccessOrders,
        totalUnsuccessOrders: item.totalUnsuccessOrders,
        usedNumbers: item.usedNumbers
      };
    });

    chartCache = { key: cacheKey, at: Date.now(), data: result };

    return NextResponse.json(result);

  } catch (error) {
    console.error("Chart API error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
