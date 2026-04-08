// app/api/overview/active-orders/route.js
import { NextResponse } from "next/server";
import Orders from "@/models/Orders";
import Services from "@/models/Service";
import dbConnect from "@/lib/db";
import { verify } from "@/lib/verify"

export async function GET(req) {
  try {
    await dbConnect();

     // Auth verification
    try {
      await verify(req)
    } catch (err) {
      return NextResponse.json({ error: err.error }, { status: err.status || 401 })
    }

    // Parse pagination parameters
    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '30'), 100); // Max 100 per page
    const skip = (page - 1) * limit;

    // Fetch active orders with server-side pagination
    const [activeOrders, total] = await Promise.all([
      Orders.find({ active: true })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Orders.countDocuments({ active: true })
    ]);

    // Fetch service names in bulk
    const serviceIds = activeOrders.map(o => o.serviceid).filter(Boolean);
    const services = await Services.find({ _id: { $in: serviceIds } }).lean();
    const serviceMap = new Map(services.map(s => [s._id.toString(), s.name]));

    // Convert UTC → IST helper
    const toIST = (date) => {
      if (!date) return null;
      return new Date(date).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
    };

    const orders = activeOrders.map(order => ({
      id: order._id,
      number: order.number,
      serviceName: order.serviceid
        ? serviceMap.get(order.serviceid.toString()) || "Unknown"
        : "Unknown",
      dialcode: order.dialcode,
      isused: order.isused,
      ismultiuse: order.ismultiuse,
      nextsms: order.nextsms,
      messageCount: order.message?.length || 0,
      keywords: order.keywords,
      formate: order.formate,
      createdAt: toIST(order.createdAt),
      updatedAt: toIST(order.updatedAt)
    }));

    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({
      orders,
      pagination: {
        page,
        limit,
        total,
        totalPages
      }
    });
  } catch (error) {
    console.error("Active Orders API error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
