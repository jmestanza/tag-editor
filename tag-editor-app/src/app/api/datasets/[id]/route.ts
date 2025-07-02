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

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const datasetId = parseInt(id);

    const body = await request.json();
    const { name } = body;

    // Validate input
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json(
        { error: "Dataset name is required and must be a non-empty string" },
        { status: 400 }
      );
    }

    // Check if dataset exists
    const existingDataset = await prisma.dataset.findUnique({
      where: { id: datasetId },
    });

    if (!existingDataset) {
      return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
    }

    // Update dataset name
    const updatedDataset = await prisma.dataset.update({
      where: { id: datasetId },
      data: {
        name: name.trim(),
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      message: "Dataset name updated successfully",
      dataset: updatedDataset,
    });
  } catch (error) {
    console.error("Failed to update dataset:", error);
    return NextResponse.json(
      { error: "Failed to update dataset" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const datasetId = parseInt(id);

    const body = await request.json();
    const { name, description } = body;

    // Validate that at least one field is provided
    if (!name && !description) {
      return NextResponse.json(
        { error: "At least one field (name or description) must be provided" },
        { status: 400 }
      );
    }

    // Validate name if provided
    if (
      name !== undefined &&
      (typeof name !== "string" || name.trim().length === 0)
    ) {
      return NextResponse.json(
        { error: "Dataset name must be a non-empty string" },
        { status: 400 }
      );
    }

    // Validate description if provided
    if (description !== undefined && typeof description !== "string") {
      return NextResponse.json(
        { error: "Dataset description must be a string" },
        { status: 400 }
      );
    }

    // Check if dataset exists
    const existingDataset = await prisma.dataset.findUnique({
      where: { id: datasetId },
    });

    if (!existingDataset) {
      return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
    }

    // Prepare update data
    const updateData: { name?: string; description?: string; updatedAt: Date } =
      {
        updatedAt: new Date(),
      };

    if (name !== undefined) {
      updateData.name = name.trim();
    }

    if (description !== undefined) {
      updateData.description = description.trim() || null;
    }

    // Update dataset
    const updatedDataset = await prisma.dataset.update({
      where: { id: datasetId },
      data: updateData,
    });

    return NextResponse.json({
      success: true,
      message: "Dataset updated successfully",
      dataset: updatedDataset,
    });
  } catch (error) {
    console.error("Failed to update dataset:", error);
    return NextResponse.json(
      { error: "Failed to update dataset" },
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
