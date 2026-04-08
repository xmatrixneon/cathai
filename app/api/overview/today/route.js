import { NextResponse } from "next/server";
import Orders from "@/models/Orders";
import dbConnect from "@/lib/db";
import { getCached } from "@/lib/cache";

export async function GET() {
  try {
    await dbConnect();

    // Get today's start and end in IST
    const now = new Date();

    // Convert current time to IST
    const istOffset = 5.5 * 60 * 60 * 1000; // +05:30
    const istNow = new Date(now.getTime() + istOffset);

    const startOfDayIST = new Date(istNow);
    startOfDayIST.setHours(0, 0, 0, 0);

    const endOfDayIST = new Date(istNow);
    endOfDayIST.setHours(23, 59, 59, 999);

    // Convert IST back to UTC before querying MongoDB
    const startOfDayUTC = new Date(startOfDayIST.getTime() - istOffset);
    const endOfDayUTC = new Date(endOfDayIST.getTime() - istOffset);

    // Use date-based cache key for auto-expiration (changes daily)
    const todayKey = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const cacheKey = `dashboard:today:${todayKey}`;

    const data = await getCached(cacheKey, async () => {
      const stats = await Orders.aggregate([
        {
          $match: {
            createdAt: { $gte: startOfDayUTC, $lte: endOfDayUTC }
          }
        },
        {
          $group: {
            _id: { hour: { $hour: { date: "$createdAt", timezone: "Asia/Kolkata" } } },
            totalSuccessOrders: {
              $sum: { $cond: [{ $eq: ["$isused", true] }, 1, 0] }
            },
            totalUnsuccessOrders: {
              $sum: { $cond: [{ $eq: ["$isused", false] }, 1, 0] }
            }
          }
        },
        { $sort: { "_id.hour": 1 } }
      ]);

      const result = Array.from({ length: 24 }, (_, i) => {
        const item = stats.find(s => s._id.hour === i);
        return item || { _id: { hour: i }, totalSuccessOrders: 0, totalUnsuccessOrders: 0 };
      }).map(item => ({
        hour: item._id.hour,
        totalSuccessOrders: item.totalSuccessOrders,
        totalUnsuccessOrders: item.totalUnsuccessOrders
      }));

      return result;
    }, 60); // 60 second TTL for today's stats

    return NextResponse.json(data);

  } catch (error) {
    console.error("Today Orders API error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
