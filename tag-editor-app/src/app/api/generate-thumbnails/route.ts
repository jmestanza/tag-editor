import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getMinioClient,
  generateAndUploadThumbnail,
  BUCKET_NAME,
} from "@/lib/minio";

interface ImageWithThumbnail {
  id: number;
  fileName: string;
  filePath: string | null;
  thumbnailPath?: string | null;
  datasetId: number;
  width: number;
  height: number;
}

export async function POST(request: Request) {
  try {
    const { datasetId } = await request.json();

    if (!datasetId) {
      return NextResponse.json(
        { error: "Dataset ID is required" },
        { status: 400 }
      );
    }

    // Get all images in the dataset that don't have thumbnails
    const allImages = (await prisma.image.findMany({
      where: {
        datasetId: parseInt(datasetId),
        filePath: {
          not: null,
        },
      },
    })) as ImageWithThumbnail[];

    // Filter out images that already have thumbnails
    const images = allImages.filter((image) => !image.thumbnailPath);

    if (images.length === 0) {
      return NextResponse.json({
        message: "No images need thumbnail generation",
        processed: 0,
      });
    }

    const client = getMinioClient();
    let processed = 0;
    const errors: string[] = [];

    for (const image of images) {
      try {
        if (!image.filePath) continue;

        // Download the original image from MinIO
        const imageBuffer = await client.getObject(BUCKET_NAME, image.filePath);
        const chunks: Buffer[] = [];

        for await (const chunk of imageBuffer) {
          chunks.push(chunk);
        }

        const buffer = Buffer.concat(chunks);

        // Generate and upload thumbnail
        const thumbnailObjectName = await generateAndUploadThumbnail(
          image.filePath,
          buffer
        );

        // Update the image record with the thumbnail path
        await prisma.$executeRaw`
          UPDATE "Image" 
          SET "thumbnailPath" = ${thumbnailObjectName}
          WHERE "id" = ${image.id}
        `;

        processed++;
      } catch (error) {
        console.error(`Error processing image ${image.fileName}:`, error);
        errors.push(
          `${image.fileName}: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    }

    return NextResponse.json({
      message: `Processed ${processed} images`,
      processed,
      errors,
      total: images.length,
    });
  } catch (error) {
    console.error("Error generating thumbnails:", error);
    return NextResponse.json(
      { error: "Failed to generate thumbnails" },
      { status: 500 }
    );
  }
}
