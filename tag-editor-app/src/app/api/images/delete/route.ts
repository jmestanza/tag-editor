import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deleteFromMinio } from "@/lib/minio";

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const imageId = searchParams.get("id");

    if (!imageId) {
      return NextResponse.json(
        { error: "Image ID is required" },
        { status: 400 }
      );
    }

    const parsedImageId = parseInt(imageId, 10);
    if (isNaN(parsedImageId)) {
      return NextResponse.json({ error: "Invalid image ID" }, { status: 400 });
    }

    // Get the image details from database
    const image = await prisma.image.findUnique({
      where: { id: parsedImageId },
      include: {
        annotations: true,
        dataset: true,
      },
    });

    if (!image) {
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }

    // Delete from MinIO storage
    const deletePromises: Promise<void>[] = [];

    // Delete main image file if it exists
    if (image.filePath) {
      deletePromises.push(
        deleteFromMinio(image.filePath).catch((error: unknown) => {
          console.warn(
            `Failed to delete main image file ${image.filePath}:`,
            error
          );
        })
      );
    }

    // Delete thumbnail if it exists
    if (image.thumbnailPath) {
      deletePromises.push(
        deleteFromMinio(image.thumbnailPath).catch((error: unknown) => {
          console.warn(
            `Failed to delete thumbnail ${image.thumbnailPath}:`,
            error
          );
        })
      );
    }

    // Execute all MinIO deletions in parallel
    await Promise.allSettled(deletePromises);

    // Delete from database (this will cascade delete annotations due to foreign key constraints)
    await prisma.image.delete({
      where: { id: parsedImageId },
    });

    return NextResponse.json({
      success: true,
      message: `Image ${image.fileName} and all associated data deleted successfully`,
      deletedImage: {
        id: image.id,
        fileName: image.fileName,
        annotationCount: image.annotations.length,
      },
    });
  } catch (error) {
    console.error("Error deleting image:", error);
    return NextResponse.json(
      {
        error: "Failed to delete image",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
