import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  // Get annotations with related image and category data
  const annotations = await prisma.annotation.findMany({
    include: {
      image: true,
      category: true,
    },
  });

  // Transform to match the expected bounding box format
  const boxes = annotations.map((ann) => ({
    id: ann.id,
    imageId: ann.image.fileName, // Use filename instead of numeric ID
    category: ann.category.name,
    x: ann.bbox[0],
    y: ann.bbox[1],
    width: ann.bbox[2],
    height: ann.bbox[3],
    createdAt: ann.createdAt,
  }));

  return NextResponse.json(boxes);
}

export async function POST(req: Request) {
  const data = await req.json();

  // For backward compatibility, still support the legacy BoundingBox model
  const newBox = await prisma.boundingBox.create({ data });
  return NextResponse.json(newBox, { status: 201 });
}
