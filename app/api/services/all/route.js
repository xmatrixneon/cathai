import { NextResponse } from 'next/server'
import connectDB from '@/lib/db'
import Service from '@/models/Service'
import { verify } from "@/lib/verify"
import { getCached } from "@/lib/cache"

export async function GET(req) {
  await connectDB()

  const result = await verify(req);

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: result.status || 401 });
  }

  // Cache services for 5 minutes (invalidated on updates)
  const services = await getCached('static:services', async () => {
    return await Service.find().lean()
  }, 300)

  return NextResponse.json(services)
}
