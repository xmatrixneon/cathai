import connectDB from "@/lib/db"
import Lock from "@/models/Lock"
import Countires from "@/models/Countires"
import Service from "@/models/Service"
import { NextResponse } from "next/server"
import { verify } from "@/lib/verify"

export async function GET(req) {
  try {
    await connectDB()

    // 🔐 Verify request (verify() returns a result, it does not throw)
    const auth = await verify(req)
    if (!auth.success) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status || 401 }
      )
    }

    // 📄 Server-side pagination (locks collection has millions of docs -
    // returning everything saturates MongoDB and hangs the site)
    const { searchParams } = new URL(req.url)
    const page = Math.max(1, parseInt(searchParams.get("page")) || 1)
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit")) || 10)
    )
    const serviceName = searchParams.get("service")

    // 🔍 Build filter
    const filter = { locked: true }

    if (serviceName && serviceName !== "All") {
      const serviceDoc = await Service.findOne({ name: serviceName }).select(
        "_id"
      )
      if (!serviceDoc) {
        return NextResponse.json(
          { success: true, locks: [], total: 0, page, totalPages: 0 },
          { status: 200 }
        )
      }
      filter.serviceid = serviceDoc._id
    }

    // Fetch page + total count in parallel (uses locked_created_compound index)
    const [locks, total] = await Promise.all([
      Lock.find(filter)
        .select("number locked createdAt updatedAt countryid serviceid")
        .populate({ path: "countryid", model: Countires, select: "name" })
        .populate({ path: "serviceid", model: Service, select: "name" })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Lock.countDocuments(filter),
    ])

    // 🔄 Transform response: include only plain countryName & serviceName
    const formatted = locks.map(lock => ({
      _id: lock._id,
      number: lock.number,
      locked: lock.locked,
      country: lock.countryid?.name || null,
      service: lock.serviceid?.name || null,
      createdAt: lock.createdAt,
      updatedAt: lock.updatedAt
    }))

    return NextResponse.json(
      {
        success: true,
        locks: formatted,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
      { status: 200 }
    )
  } catch (error) {
    console.error("Error fetching locked numbers:", error)
    return NextResponse.json(
      { success: false, error: "Unable to load locked numbers" },
      { status: 500 }
    )
  }
}
