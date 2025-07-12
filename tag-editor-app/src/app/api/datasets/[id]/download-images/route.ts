import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getMinioClient, BUCKET_NAME } from "@/lib/minio";
import JSZip from "jszip";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const datasetId = parseInt(id);

    if (isNaN(datasetId)) {
      return NextResponse.json(
        { error: "Invalid dataset ID" },
        { status: 400 }
      );
    }

    // Fetch the dataset with all images
    const dataset = await prisma.dataset.findUnique({
      where: { id: datasetId },
      include: {
        images: {
          where: {
            filePath: { not: null }, // Only include images that have been uploaded
          },
          orderBy: {
            fileName: "asc",
          },
        },
      },
    });

    if (!dataset) {
      return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
    }

    if (dataset.images.length === 0) {
      return NextResponse.json(
        { error: "No images found in this dataset" },
        { status: 404 }
      );
    }

    const client = getMinioClient();
    const zip = new JSZip();

    // Create a folder in the zip with the dataset name
    const folderName = (dataset.name || `dataset_${datasetId}`)
      .replace(/[^a-z0-9]/gi, "_")
      .toLowerCase();
    const folder = zip.folder(folderName);

    if (!folder) {
      throw new Error("Failed to create folder in zip");
    }

    // Download and add each image to the zip
    for (const image of dataset.images) {
      if (!image.filePath) continue;

      try {
        // Get the image from MinIO
        const stream = await client.getObject(BUCKET_NAME, image.filePath);

        // Convert stream to buffer
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
          chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);

        // Add the file to the zip with its original filename
        folder.file(image.fileName, buffer);
      } catch (error) {
        console.error(`Failed to download image ${image.fileName}:`, error);
        // Continue with other images if one fails
      }
    }

    // Generate the zip file
    const zipBuffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: {
        level: 6,
      },
    });

    // Set response headers for file download
    const fileName = `${folderName}_images.zip`;

    return new NextResponse(zipBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": zipBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error("Failed to download dataset images:", error);
    return NextResponse.json(
      {
        error: "Failed to download dataset images",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
