import { NextResponse } from "next/server";
import Device from "@/models/Device";
import { getCached, CACHE_TTL } from "@/lib/cache";
import dbConnect from "@/lib/db";

export async function GET() {
  try {
    await dbConnect();
    const data = await getCached('dashboard:overview:device-stats', async () => {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0);
      const yesterdayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59);

      const [todayStats, yesterdayStats, last24hStats, todayReg, yesterdayReg] = await Promise.all([
        // Devices ACTIVE today (heartbeat since midnight) — the online-rate
        // denominator. Registered-today was the old denominator; it is diluted
        // by throwaway farm devices that register and die within minutes
        // (21% of daily intake), which made the rate card read ~25%.
        Device.aggregate([
          { $match: { isActive: true, lastHeartbeat: { $gte: todayStart } } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              online: { $sum: { $cond: [{ $eq: ["$status", "online"] }, 1, 0] } },
              offline: { $sum: { $cond: [{ $eq: ["$status", "offline"] }, 1, 0] } }
            }
          }
        ]),
        // Devices seen since yesterday 00:00 (~35h rolling window). NOT
        // "heartbeat inside yesterday" — that bucket structurally excludes
        // anyone online now (their heartbeat is today), making online=0.
        Device.aggregate([
          { $match: { isActive: true, lastHeartbeat: { $gte: yesterdayStart } } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              online: { $sum: { $cond: [{ $eq: ["$status", "online"] }, 1, 0] } },
              offline: { $sum: { $cond: [{ $eq: ["$status", "offline"] }, 1, 0] } }
            }
          }
        ]),
        Device.aggregate([
          { $match: { isActive: true, lastHeartbeat: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              online: { $sum: { $cond: [{ $eq: ["$status", "online"] }, 1, 0] } },
              offline: { $sum: { $cond: [{ $eq: ["$status", "offline"] }, 1, 0] } }
            }
          }
        ]),
        // True registration cohorts — feed the registration-count cards
        Device.aggregate([
          { $match: { createdAt: { $gte: todayStart, $lte: todayEnd } } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              online: { $sum: { $cond: [{ $eq: ["$status", "online"] }, 1, 0] } },
              offline: { $sum: { $cond: [{ $eq: ["$status", "offline"] }, 1, 0] } }
            }
          }
        ]),
        Device.aggregate([
          { $match: { createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd } } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              online: { $sum: { $cond: [{ $eq: ["$status", "online"] }, 1, 0] } },
              offline: { $sum: { $cond: [{ $eq: ["$status", "offline"] }, 1, 0] } }
            }
          }
        ])
      ]);

      return {
        today: todayStats[0] || { total: 0, online: 0, offline: 0 },
        yesterday: yesterdayStats[0] || { total: 0, online: 0, offline: 0 },
        last24h: last24hStats[0] || { total: 0, online: 0, offline: 0 },
        todayRegistrations: todayReg[0] || { total: 0, online: 0, offline: 0 },
        yesterdayRegistrations: yesterdayReg[0] || { total: 0, online: 0, offline: 0 }
      };
    }, CACHE_TTL.OVERVIEW_STATS);

    return NextResponse.json(data);
  } catch (error) {
    console.error("Device stats API error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
