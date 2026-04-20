// app/api/overview/route.js
import { NextResponse } from "next/server";
import Numbers from "@/models/Numbers"; // adjust path
import Orders from "@/models/Orders";   // adjust path
import dbConnect from "@/lib/db";       // your db connection util
import CronStatus  from "@/models/Cron";
import { getCached, CACHE_TTL } from "@/lib/cache";

export async function GET() {
  try {
    await dbConnect(); // ensure MongoDB is connected

    // Use caching with 5-minute TTL for dashboard data (OPTIMIZED for 62GB RAM)
    const data = await getCached('dashboard:overview:data', async () => {
      // Parallelize all queries for better performance
      const [totalNumbers, activeOrders, occupiedNumbers, totalActivations, cronStatuses] =
        await Promise.all([
          // Total numbers - count only ACTIVE to match SIM Numbers page
          Numbers.countDocuments({ active: true }),

          // Active orders (all, not unique)
          Orders.countDocuments({ active: true }),

          // Occupied numbers (unique active numbers that have orders)
          Orders.aggregate([
            { $match: { active: true } },
            { $group: { _id: "$number" } },
            { $count: "count" }
          ]),

          // Total activations (isused = true)
          Orders.countDocuments({ isused: true }),

          // Get all cron statuses
          CronStatus.find({})
        ]);

      const occupied = occupiedNumbers.length > 0 ? occupiedNumbers[0].count : 0;

      const cronMap = new Map();
      for (const cron of cronStatuses) {
        cronMap.set(cron.name, cron.lastRun ? new Date(cron.lastRun).toISOString() : null);
      }

      // Send raw ISO date strings so frontend can format them properly
      let lastcron = cronMap.get("fetchOrders") || null;
      let lastsync = cronMap.get("syncStatus") || null;

      // Response
      return {
        totalNumbers,
        activeOrders,                // total active orders
        occupiedNumbers: occupied,   // unique active numbers
        availableNumbers: totalNumbers - occupied,
        totalActivations,             // orders marked as used
        lastcron: lastcron,          // fetchOrders cron
        lastsync: lastsync           // syncStatus cron
      };
    }, CACHE_TTL.OVERVIEW_STATS); // 5 minute TTL - optimized for 62GB RAM

    return NextResponse.json(data);

  } catch (error) {
    console.error("Overview API error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
