import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const datasetId = parseInt(id);

    const dataset = await prisma.dataset.findUnique({
      where: { id: datasetId },
      include: {
        images: {
          include: {
            annotations: {
              include: {
                category: true,
              },
            },
          },
          orderBy: {
            dateCaptured: "asc",
          },
        },
        categories: true,
      },
    });

    if (!dataset) {
      return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
    }

    return NextResponse.json(dataset);
  } catch (error) {
    console.error("Failed to fetch dataset:", error);
    return NextResponse.json(
      { error: "Failed to fetch dataset" },
      { status: 500 }
    );
  }
}
