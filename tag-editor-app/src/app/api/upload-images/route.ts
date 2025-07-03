import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  initializeBucket,
  uploadToMinio,
  getMinioProxyUrl,
  generateAndUploadThumbnail,
} from "@/lib/minio";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const datasetId = formData.get("datasetId") as string;
    const files = formData.getAll("images") as File[];

    if (!datasetId) {
      return NextResponse.json(
        { error: "Dataset ID is required" },
        { status: 400 }
      );
    }

    if (!files.length) {
      return NextResponse.json(
        { error: "No images provided" },
        { status: 400 }
      );
    }

    // Verify dataset exists
    const dataset = await prisma.dataset.findUnique({
      where: { id: parseInt(datasetId) },
    });

    if (!dataset) {
      return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
    }

    // Initialize MinIO bucket
    await initializeBucket();

    const uploadedFiles = [];
    const errors = [];

    for (const file of files) {
      try {
        // Convert file to buffer
        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        // Create object name with dataset prefix
        const objectName = `dataset-${datasetId}/${file.name}`;

        // Determine content type
        const contentType = file.type || "image/jpeg";

        // Upload to MinIO
        const uploadedObjectName = await uploadToMinio(
          objectName,
          buffer,
          contentType
        );

        // Generate and upload thumbnail
        const thumbnailObjectName = await generateAndUploadThumbnail(
          uploadedObjectName,
          buffer
        );

        // Update the image record in the database with the object name and thumbnail
        const image = await prisma.image.findFirst({
          where: {
            fileName: file.name,
            datasetId: parseInt(datasetId),
          },
        });

        if (image) {
          await prisma.$executeRaw`
            UPDATE "Image" 
            SET "filePath" = ${uploadedObjectName}, "thumbnailPath" = ${thumbnailObjectName}
            WHERE "id" = ${image.id}
          `;
        }

        const proxyUrl = getMinioProxyUrl(uploadedObjectName);

        uploadedFiles.push({
          fileName: file.name,
          path: proxyUrl,
        });
      } catch (error) {
        console.error(`Error uploading ${file.name}:`, error);
        errors.push({
          fileName: file.name,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return NextResponse.json({
      message: "Images upload completed",
      uploaded: uploadedFiles,
      errors: errors,
      stats: {
        successful: uploadedFiles.length,
        failed: errors.length,
        total: files.length,
      },
    });
  } catch (error) {
    console.error("Upload images error:", error);
    return NextResponse.json(
      { error: "Failed to upload images" },
      { status: 500 }
    );
  }
}
