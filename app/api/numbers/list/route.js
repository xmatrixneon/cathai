// app/api/numbers/route.js
import { NextResponse } from "next/server";
import dbConnect from "@/lib/db";
import Numbers from "@/models/Numbers";
import Countries from "@/models/Countires"; // your Countries model
import { verify } from "@/lib/verify";

export async function GET(req) {
  try {
    // JWT verification
    await verify(req);

    // Connect to MongoDB
    await dbConnect();

    // Use aggregation pipeline instead of populate (much faster)
    const startTime = Date.now();

    const numbers = await Numbers.aggregate([
      { $match: { active: true } }, // Filter active numbers first
      {
        $lookup: {
          from: "countires", // Join with countries collection
          localField: "countryid",
          foreignField: "_id",
          as: "country",
          pipeline: [
            { $project: { name: 1, flag: 1, code: 1 } } // Only select needed fields
          ]
        }
      },
      {
        $unwind: {
          path: "$country",
          preserveNullAndEmptyArrays: true // Keep numbers without country data
        }
      },
      {
        $sort: { qualityScore: -1, createdAt: -1 } // Sort by quality then creation date
      }
    ]);

    const queryTime = Date.now() - startTime;
    console.log(`Numbers list query time: ${queryTime}ms (${numbers.length} numbers)`);

    return NextResponse.json({ success: true, data: numbers });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err.error || "Something went wrong" },
      { status: err.status || 500 }
    );
  }
}
