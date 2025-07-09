import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const datasetId = searchParams.get("id");

    // If ID is provided, return specific dataset
    if (datasetId) {
      // Pagination parameters
      const page = parseInt(searchParams.get("page") || "1");
      const pageSize = parseInt(searchParams.get("pageSize") || "8");
      const skip = (page - 1) * pageSize;

      const dataset = await prisma.dataset.findUnique({
        where: { id: parseInt(datasetId) },
        include: {
          categories: true,
        },
      });

      if (!dataset) {
        return NextResponse.json(
          { error: "Dataset not found" },
          { status: 404 }
        );
      }

      // Get total count of uploaded images (images with filePath)
      const totalUploadedImages = await prisma.image.count({
        where: {
          datasetId: parseInt(datasetId),
          filePath: { not: null },
        },
      });

      // Get paginated images
      const images = await prisma.image.findMany({
        where: {
          datasetId: parseInt(datasetId),
          filePath: { not: null },
        },
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
        skip,
        take: pageSize,
      });

      // Get the total number of images defined in the COCO JSON (all images in the dataset)
      const totalExpectedImages = await prisma.image.count({
        where: { datasetId: parseInt(datasetId) },
      });

      // Get the count of images that have actual uploaded files
      const uploadedImagesCount = totalUploadedImages;

      return NextResponse.json({
        ...dataset,
        images, // Paginated images
        pagination: {
          page,
          pageSize,
          totalPages: Math.ceil(totalUploadedImages / pageSize),
          totalImages: totalUploadedImages,
          hasNextPage: page * pageSize < totalUploadedImages,
          hasPreviousPage: page > 1,
        },
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
