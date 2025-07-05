import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  initializeBucket,
  uploadToMinio,
  getMinioProxyUrl,
  generateAndUploadThumbnail,
} from "@/lib/minio";

// Configure the route for large batch uploads
export const runtime = "nodejs";
export const maxDuration = 600; // 10 minutes for batch processing
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let uploadedFiles: { fileName: string; path: string }[] = [];
  let errors: { fileName: string; error: string }[] = [];
  let processed = 0;

  try {
    const formData = await request.formData();
    const datasetId = formData.get("datasetId") as string;
    const files = formData.getAll("images") as File[];

    console.log(
      `Starting batch upload for dataset ${datasetId} with ${files.length} files`
    );

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

    // Check if this is too many files for a single batch
    if (files.length > 50) {
      return NextResponse.json(
        {
          error:
            "Too many files in single request. Maximum 50 files per batch.",
        },
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

    uploadedFiles = [];
    errors = [];
    processed = 0;

    // Process files in parallel with concurrency limit
    const CONCURRENCY_LIMIT = 5; // Process max 5 files simultaneously
    const fileChunks = [];

    for (let i = 0; i < files.length; i += CONCURRENCY_LIMIT) {
      fileChunks.push(files.slice(i, i + CONCURRENCY_LIMIT));
    }

    for (const chunk of fileChunks) {
      const chunkPromises = chunk.map(async (file) => {
        try {
          console.log(`Processing file: ${file.name}`);

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

          return {
            success: true,
            fileName: file.name,
            path: proxyUrl,
          };
        } catch (error) {
          console.error(`Error uploading ${file.name}:`, error);
          return {
            success: false,
            fileName: file.name,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      });

      // Wait for current chunk to complete
      const chunkResults = await Promise.all(chunkPromises);

      // Process results
      chunkResults.forEach((result) => {
        processed++;
        if (result.success) {
          uploadedFiles.push({
            fileName: result.fileName,
            path: result.path || "",
          });
        } else {
          errors.push({
            fileName: result.fileName,
            error: result.error || "Unknown error",
          });
        }
      });

      // Force garbage collection between chunks if available
      if (global.gc) {
        global.gc();
      }

      console.log(`Processed ${processed}/${files.length} files`);
    }

    console.log(
      `Batch upload completed. Success: ${uploadedFiles.length}, Errors: ${errors.length}`
    );

    return NextResponse.json({
      message: `Batch upload completed`,
      uploaded: uploadedFiles,
      errors: errors,
      stats: {
        successful: uploadedFiles.length,
        failed: errors.length,
        total: files.length,
        processed: processed,
      },
    });
  } catch (error) {
    console.error("Batch upload error:", error);
    return NextResponse.json(
      {
        error: "Failed to upload batch",
        details: error instanceof Error ? error.message : "Unknown error",
        stats: {
          successful: uploadedFiles.length,
          failed: errors.length,
          total: processed,
          processed: processed,
        },
      },
      { status: 500 }
    );
  }
}
