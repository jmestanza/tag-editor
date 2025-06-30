import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

// GET /api/categories?datasetId=123
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const datasetId = searchParams.get("datasetId");

    if (!datasetId) {
      return NextResponse.json(
        { error: "Missing datasetId parameter" },
        { status: 400 }
      );
    }

    const categories = await prisma.category.findMany({
      where: {
        datasetId: parseInt(datasetId),
      },
      orderBy: {
        name: "asc",
      },
    });

    return NextResponse.json({
      success: true,
      categories: categories.map((cat) => ({
        id: cat.id,
        name: cat.name,
        supercategory: cat.supercategory,
      })),
    });
  } catch (error) {
    console.error("Error fetching categories:", error);
    return NextResponse.json(
      { error: "Failed to fetch categories" },
      { status: 500 }
    );
  }
}
