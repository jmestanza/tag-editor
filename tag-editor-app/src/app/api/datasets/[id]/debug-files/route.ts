import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { listObjects } from "@/lib/minio";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const datasetId = parseInt(id);

    // Get dataset images with file paths
    const dataset = await prisma.dataset.findUnique({
      where: { id: datasetId },
      include: {
        images: {
          select: {
            id: true,
            fileName: true,
            filePath: true,
          },
        },
      },
    });

    if (!dataset) {
      return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
    }

    // Get all objects from MinIO
    const allMinioObjects = await listObjects();

    // Get images that have file paths
    const imagesWithPaths = dataset.images.filter((image) => image.filePath);

    // Check which files exist in MinIO
    const fileStatus = imagesWithPaths.map((image) => ({
      imageId: image.id,
      fileName: image.fileName,
      filePath: image.filePath,
      existsInMinio: allMinioObjects.includes(image.filePath!),
    }));

    return NextResponse.json({
      datasetId,
      datasetName: dataset.name,
      totalImages: dataset.images.length,
      imagesWithPaths: imagesWithPaths.length,
      fileStatus,
      allMinioObjects: allMinioObjects.filter((obj) =>
        obj.startsWith(`dataset-${datasetId}/`)
      ),
      minioObjectCount: allMinioObjects.length,
    });
  } catch (error) {
    console.error("Failed to debug dataset files:", error);
    return NextResponse.json(
      { error: "Failed to debug dataset files" },
      { status: 500 }
    );
  }
}
