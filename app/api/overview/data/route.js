// app/api/overview/route.js
import { NextResponse } from "next/server";
import Numbers from "@/models/Numbers"; // adjust path
import Orders from "@/models/Orders";   // adjust path
import dbConnect from "@/lib/db";       // your db connection util
import CronStatus  from "@/models/Cron";
export async function GET() {
  try {
    await dbConnect(); // ensure MongoDB is connected

    // Total numbers - count only ACTIVE to match SIM Numbers page
    const totalNumbers = await Numbers.countDocuments({ active: true });

    // Active orders (all, not unique)
    const activeOrders = await Orders.countDocuments({ active: true });

    // Occupied numbers (unique active numbers that have orders)
    const occupiedNumbers = await Orders.aggregate([
      { $match: { active: true } },
      { $group: { _id: "$number" } },
      { $count: "count" }
    ]);

    const occupied = occupiedNumbers.length > 0 ? occupiedNumbers[0].count : 0;

    // Total activations (isused = true)
    const totalActivations = await Orders.countDocuments({ isused: true });

    // Get all cron statuses
    const cronStatuses = await CronStatus.find({});
    const cronMap = new Map();
    for (const cron of cronStatuses) {
      cronMap.set(cron.name, cron.lastRun ? new Date(cron.lastRun).toISOString() : null);
    }

    // Send raw ISO date strings so frontend can format them properly
    let lastcron = cronMap.get("fetchOrders") || null;
    let lastsync = cronMap.get("syncStatus") || null;

    // Response
    return NextResponse.json({
      totalNumbers,
      activeOrders,                // total active orders
      occupiedNumbers: occupied,   // unique active numbers
      availableNumbers: totalNumbers - occupied,
      totalActivations,             // orders marked as used
      lastcron: lastcron,          // fetchOrders cron
      lastsync: lastsync           // syncStatus cron
    });
  } catch (error) {
    console.error("Overview API error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
