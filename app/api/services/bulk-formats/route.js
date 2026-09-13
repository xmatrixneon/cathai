import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/db";
import Service from "@/models/Service";
import { verify } from "@/lib/verify";
import { deleteCache } from "@/lib/cache";

const MAX_SERVICE_IDS = 2000;
const MAX_FORMATS = 50;
const MAX_FORMAT_LENGTH = 2000;

export async function POST(req) {
  try {
    await connectDB();

    const result = await verify(req);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status || 401 });
    }

    const body = await req.json();
    const { serviceIds, formats, mode } = body;

    if (mode !== "add" && mode !== "remove") {
      return NextResponse.json(
        { success: false, error: "Invalid mode. Must be 'add' or 'remove'" },
        { status: 400 }
      );
    }

    if (!Array.isArray(serviceIds) || serviceIds.length === 0) {
      return NextResponse.json(
        { success: false, error: "No services selected" },
        { status: 400 }
      );
    }

    if (serviceIds.length > MAX_SERVICE_IDS) {
      return NextResponse.json(
        { success: false, error: `Too many services selected (max ${MAX_SERVICE_IDS})` },
        { status: 400 }
      );
    }

    // Invalid ObjectIds throw CastError inside bulkWrite and kill the whole batch
    const invalidId = serviceIds.find((id) => !mongoose.isValidObjectId(id));
    if (invalidId) {
      return NextResponse.json(
        { success: false, error: "Invalid service ID in selection" },
        { status: 400 }
      );
    }

    const uniqueIds = [...new Set(serviceIds)];

    // Exact-match policy: trim only, no case or whitespace normalization
    const cleanedFormats = [
      ...new Set(
        (Array.isArray(formats) ? formats : [])
          .map((f) => (typeof f === "string" ? f.trim() : ""))
          .filter(Boolean)
      ),
    ];

    if (cleanedFormats.length === 0) {
      return NextResponse.json(
        { success: false, error: "No non-empty formats provided" },
        { status: 400 }
      );
    }

    if (cleanedFormats.length > MAX_FORMATS) {
      return NextResponse.json(
        { success: false, error: `Too many formats (max ${MAX_FORMATS})` },
        { status: 400 }
      );
    }

    const tooLong = cleanedFormats.find((f) => f.length > MAX_FORMAT_LENGTH);
    if (tooLong) {
      return NextResponse.json(
        { success: false, error: `Format too long (max ${MAX_FORMAT_LENGTH} characters)` },
        { status: 400 }
      );
    }

    const ops = uniqueIds.map((id) => ({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(id) },
        update:
          mode === "add"
            ? { $addToSet: { formate: { $each: cleanedFormats } } }
            : { $pull: { formate: { $in: cleanedFormats } } },
      },
    }));

    // ordered: false so one stale/deleted ID cannot abort the remaining updates
    const bulkResult = await Service.bulkWrite(ops, { ordered: false });

    // Invalidate services cache
    await deleteCache("static:services");

    return NextResponse.json({
      success: true,
      mode,
      matched: bulkResult.matchedCount,
      modified: bulkResult.modifiedCount,
      requested: uniqueIds.length,
      formats: cleanedFormats,
    });
  } catch (error) {
    console.error("Bulk format update error:", error);
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}
