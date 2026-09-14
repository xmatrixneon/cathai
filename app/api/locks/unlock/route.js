// /app/api/lock/unlock/route.js
import connectDB from "@/lib/db"
import Lock from "@/models/Lock"
import { NextResponse } from "next/server"
import { verify } from "@/lib/verify"

export async function POST(req) {
  try {
    await connectDB()

    // 🔐 Verify request
    const auth = await verify(req)
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
    }

    const { id } = await req.json()
    if (!id) {
      return NextResponse.json({ error: "Lock ID is required" }, { status: 400 })
    }

    // 🔓 Update lock
    const updated = await Lock.findByIdAndUpdate(
      id,
      { locked: false },
      { new: true }
    )

    if (!updated) {
      return NextResponse.json({ error: "Lock not found" }, { status: 404 })
    }

    return NextResponse.json({ message: "Unlocked successfully", lock: updated })
  } catch (err) {
    console.error("Unlock error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
