import { NextResponse } from "next/server";
import dbConnect from "@/lib/db";
import Orders from "@/models/Orders";
import Countries from "@/models/Countires";
import Services from "@/models/Service";
import { verify } from "@/lib/verify";

export async function GET(req) {
  try {
    await dbConnect();

    // 🔐 Verify request (verify() returns a result, it does not throw)
    const auth = await verify(req)
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
    }

    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const status = searchParams.get("status") || "all";
    const search = (searchParams.get("search") || "").trim();
    const page = Math.max(1, parseInt(searchParams.get("page")) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit")) || 10)
    );

    const query = {};

    if (from || to) {
      // custom range
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    } else {
      // Default: Today's orders in Indian Standard Time (IST)
      const now = new Date();

      // Convert current UTC time to IST (UTC+5:30)
      const istOffset = 5.5 * 60 * 60 * 1000; // 5 hours 30 minutes in ms
      const istNow = new Date(now.getTime() + istOffset);

      // Start of today in IST
      const istStart = new Date(
        istNow.getFullYear(),
        istNow.getMonth(),
        istNow.getDate(),
        0,
        0,
        0,
        0
      );

      // End of today in IST
      const istEnd = new Date(
        istNow.getFullYear(),
        istNow.getMonth(),
        istNow.getDate(),
        23,
        59,
        59,
        999
      );

      // Convert IST boundaries back to UTC for MongoDB comparison
      query.createdAt = {
        $gte: new Date(istStart.getTime() - istOffset),
        $lte: new Date(istEnd.getTime() - istOffset),
      };
    }

    // Status filter (matches getOrderStatus() on the frontend)
    if (status === "used") {
      query.isused = true;
    } else if (status === "pending") {
      query.isused = false;
      query.active = true;
    } else if (status === "canceled") {
      query.isused = false;
      query.active = false;
    }

    // Search: match number, country name, or service name
    if (search) {
      const orConditions = [];

      // Numeric search matches the phone number (numeric field - needs $expr regex)
      if (/^\d+$/.test(search)) {
        orConditions.push({
          $expr: {
            $regexMatch: { input: { $toString: "$number" }, regex: search },
          },
        });
      }

      // Resolve country/service names to ids (small collections)
      const nameRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const [matchingCountries, matchingServices] = await Promise.all([
        Countries.find({ name: nameRegex }).select("_id").lean(),
        Services.find({ name: nameRegex }).select("_id").lean(),
      ]);
      if (matchingCountries.length > 0) {
        orConditions.push({ countryid: { $in: matchingCountries.map(c => c._id) } });
      }
      if (matchingServices.length > 0) {
        orConditions.push({ serviceid: { $in: matchingServices.map(s => s._id) } });
      }

      if (orConditions.length > 0) {
        query.$or = orConditions;
      } else {
        // Nothing matches the search string
        return NextResponse.json(
          { success: true, orders: [], total: 0, page, totalPages: 0 },
          { status: 200 }
        );
      }
    }

    const [orders, total] = await Promise.all([
      Orders.find(query)
        .select("number countryid serviceid createdAt isused active message")
        .populate({
          path: "countryid",
          model: Countries,
          select: "name flag code dial active",
        })
        .populate({
          path: "serviceid",
          model: Services,
          select: "name code image",
        })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Orders.countDocuments(query),
    ]);

    return NextResponse.json(
      {
        success: true,
        count: orders.length,
        orders,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching order history:", error);
    return NextResponse.json(
      { success: false, message: "Failed to fetch order history" },
      { status: 500 }
    );
  }
}
