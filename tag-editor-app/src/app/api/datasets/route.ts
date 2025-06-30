import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

interface ImageWithFilePath {
  filePath?: string | null;
  [key: string]: unknown;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const datasetId = searchParams.get("id");

    // If ID is provided, return specific dataset
    if (datasetId) {
      const dataset = await prisma.dataset.findUnique({
        where: { id: parseInt(datasetId) },
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
        return NextResponse.json(
          { error: "Dataset not found" },
          { status: 404 }
        );
      }

      // Filter out images without uploaded files (filePath is null)
      const uploadedImages = (
        dataset.images as unknown as ImageWithFilePath[]
      ).filter((image) => image.filePath !== null);

      // Get the total number of images defined in the COCO JSON (all images in the dataset)
      const totalExpectedImages = await prisma.image.count({
        where: { datasetId: parseInt(datasetId) },
      });

      // Get the count of images that have actual uploaded files
      const uploadedImagesCount = uploadedImages.length;

      return NextResponse.json({
        ...dataset,
        images: uploadedImages, // Only return images that have been uploaded
        expectedImageCount: totalExpectedImages,
        uploadedImageCount: uploadedImagesCount,
      });
    }

    // Otherwise return all datasets
    const datasets = await prisma.dataset.findMany({
      include: {
        _count: {
          select: {
            images: true,
            categories: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json(datasets);
  } catch (error) {
    console.error("Failed to fetch datasets:", error);
    return NextResponse.json(
      { error: "Failed to fetch datasets" },
      { status: 500 }
    );
  }
}
