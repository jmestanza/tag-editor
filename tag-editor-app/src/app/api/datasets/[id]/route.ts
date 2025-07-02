import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deleteFromMinio } from "@/lib/minio";

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

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const datasetId = parseInt(id);

    // First, fetch the dataset to get all images with their file paths
    const dataset = await prisma.dataset.findUnique({
      where: { id: datasetId },
      include: {
        images: {
          select: {
            filePath: true,
          },
        },
      },
    });

    if (!dataset) {
      return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
    }

    // Delete images from MinIO bucket
    const imagesToDelete = dataset.images.filter((image) => image.filePath);
    console.log(
      `Attempting to delete ${imagesToDelete.length} images from MinIO for dataset ${datasetId}`
    );

    const deletePromises = imagesToDelete.map((image) => {
      console.log(`Queuing deletion for: ${image.filePath}`);
      return deleteFromMinio(image.filePath!);
    });

    // Delete files from MinIO (continue even if some fail)
    const deleteResults = await Promise.allSettled(deletePromises);
    const failedDeletes = deleteResults.filter(
      (result) => result.status === "rejected"
    ).length;

    if (failedDeletes > 0) {
      console.warn(
        `Failed to delete ${failedDeletes} images from MinIO out of ${imagesToDelete.length}`
      );
      // Log the specific errors for debugging
      deleteResults.forEach((result, index) => {
        if (result.status === "rejected") {
          console.error(
            `Failed to delete ${imagesToDelete[index].filePath}:`,
            result.reason
          );
        }
      });
    }

    // Delete dataset from database (this will cascade delete all related records)
    await prisma.dataset.delete({
      where: { id: datasetId },
    });

    return NextResponse.json({
      success: true,
      message: `Dataset deleted successfully. ${
        imagesToDelete.length - failedDeletes
      } images deleted from storage.`,
      filesDeleted: imagesToDelete.length - failedDeletes,
      filesFailedToDelete: failedDeletes,
      totalFilesToDelete: imagesToDelete.length,
      deletionSummary: {
        successful: imagesToDelete.length - failedDeletes,
        failed: failedDeletes,
        total: imagesToDelete.length,
      },
    });
  } catch (error) {
    console.error("Failed to delete dataset:", error);
    return NextResponse.json(
      { error: "Failed to delete dataset" },
      { status: 500 }
    );
  }
}
