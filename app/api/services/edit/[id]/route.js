import { NextResponse } from "next/server";
import connectDB from "@/lib/db";
import Service from "@/models/Service";
import { verify } from "@/lib/verify"
import { deleteCache } from "@/lib/cache"

export async function PUT(request, { params }) {
  try {
    await connectDB();
     try {
      await verify(request)
    } catch (err) {
      return NextResponse.json({ error: err.error }, { status: err.status || 401 })
    }
    const body = await request.json();

    const updated = await Service.findByIdAndUpdate(params.id, body, {
      new: true,
      runValidators: true,
    });

    if (!updated) {
      return NextResponse.json({ error: "Service not found" }, { status: 404 });
    }

    // Invalidate services cache
    await deleteCache('static:services')

    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
