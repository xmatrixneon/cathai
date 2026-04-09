import connectDB from "@/lib/db"
import Countires from "@/models/Countires"
import { NextResponse } from "next/server"
import { verify } from "@/lib/verify"
import { getCached } from "@/lib/cache"

export async function GET(req) {
  try {
    await connectDB()
    try {
      await verify(req)
    } catch (err) {
      return NextResponse.json({ error: err.error }, { status: err.status || 401 })
    }

    // Cache countries for 5 minutes (invalidated on updates)
    const countries = await getCached('static:countries', async () => {
      return await Countires.find().sort({ name: 1 }).lean()
    }, 300)

    return NextResponse.json({ success: true, countries }, { status: 200 })
  } catch (error) {
    console.error("Error fetching countries:", error)
    return NextResponse.json({ success: false, error: "Unable to load countries" }, { status: 500 })
  }
}
