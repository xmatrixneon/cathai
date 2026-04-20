import { NextResponse } from 'next/server'
import connectDB from '@/lib/db'
import Service from '@/models/Service'
import { verify } from "@/lib/verify"
import { getCached, CACHE_TTL } from "@/lib/cache"

export async function GET(req) {
  await connectDB()

  const result = await verify(req);

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: result.status || 401 });
  }

  // Cache services for 1 hour (rarely change, invalidated on updates)
  const services = await getCached('static:services', async () => {
    return await Service.find().lean()
  }, CACHE_TTL.SERVICES_LIST)

  return NextResponse.json(services)
}
