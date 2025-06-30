import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

interface COCOInfo {
  year?: number;
  version?: string;
  description?: string;
  contributor?: string;
  url?: string;
  date_created?: string;
}

interface COCOLicense {
  id: number;
  name: string;
  url?: string;
}

interface COCOCategory {
  id: number;
  name: string;
  supercategory?: string;
}

interface COCOImage {
  id: number;
  file_name: string;
  width: number;
  height: number;
  date_captured?: string;
  license?: number;
}

interface COCOAnnotation {
  id: number;
  image_id: number;
  category_id: number;
  bbox: [number, number, number, number]; // [x, y, width, height]
  area: number;
  iscrowd?: number;
}

interface COCOData {
  images: COCOImage[];
  annotations: COCOAnnotation[];
  categories: COCOCategory[];
  info?: COCOInfo;
  licenses?: COCOLicense[];
}

export async function POST(request: Request) {
  try {
    const data: COCOData = await request.json();

    console.log("Received COCO JSON:", {
      images: data.images?.length || 0,
      annotations: data.annotations?.length || 0,
      categories: data.categories?.length || 0,
    });

    // Validate required fields
    if (!data.images || !data.annotations || !data.categories) {
      return NextResponse.json(
        {
          error:
            "Invalid COCO format: missing required fields (images, annotations, categories)",
        },
        { status: 400 }
      );
    }

    // For very large datasets, we might need to process in smaller batches
    const BATCH_SIZE = 500; // Reduced batch size for better memory management
    const isLargeDataset = data.annotations.length > 2000; // Lower threshold

    if (isLargeDataset) {
      console.log(
        `Processing large dataset with ${data.annotations.length} annotations in batches of ${BATCH_SIZE}...`
      );
    }

    // Save data to database in a transaction with increased timeout
    const result = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // Create a new dataset
        const dataset = await tx.dataset.create({
          data: {
            name: `Dataset ${new Date().toISOString()}`,
            description: `Uploaded COCO dataset with ${data.images.length} images`,
          },
        });

        // Create categories in batch
        const categoriesToCreate = data.categories.map((cat) => ({
          cocoId: cat.id,
          name: cat.name,
          supercategory: cat.supercategory,
          datasetId: dataset.id,
        }));

        await tx.category.createMany({
          data: categoriesToCreate,
        });

        // Get created categories to build mapping
        const createdCategories = await tx.category.findMany({
          where: { datasetId: dataset.id },
          select: { id: true, cocoId: true },
        });

        const categoryMappings = new Map<number, number>();
        createdCategories.forEach((cat) => {
          categoryMappings.set(cat.cocoId, cat.id);
        });

        // Create images in batch
        const imagesToCreate = data.images.map((img) => ({
          cocoId: img.id,
          fileName: img.file_name,
          width: img.width,
          height: img.height,
          dateCaptured: img.date_captured ? new Date(img.date_captured) : null,
          license: img.license,
          datasetId: dataset.id,
        }));

        await tx.image.createMany({
          data: imagesToCreate,
        });

        // Get created images to build mapping
        const createdImages = await tx.image.findMany({
          where: { datasetId: dataset.id },
          select: { id: true, cocoId: true },
        });

        const imageMappings = new Map<number, number>();
        createdImages.forEach((img) => {
          imageMappings.set(img.cocoId, img.id);
        });

        // Create annotations using the mapped IDs
        const annotationsToCreate = data.annotations.map((ann) => {
          const imageId = imageMappings.get(ann.image_id);
          const categoryId = categoryMappings.get(ann.category_id);

          if (!imageId || !categoryId) {
            throw new Error(
              `Invalid reference: image_id ${ann.image_id} or category_id ${ann.category_id} not found`
            );
          }

          return {
            cocoId: ann.id,
            imageId: imageId,
            categoryId: categoryId,
            bbox: ann.bbox,
            area: ann.area,
            iscrowd: ann.iscrowd || 0,
            datasetId: dataset.id,
          };
        });

        // Process annotations in batches for large datasets
        if (isLargeDataset) {
          const totalBatches = Math.ceil(
            annotationsToCreate.length / BATCH_SIZE
          );
          console.log(
            `Processing ${annotationsToCreate.length} annotations in ${totalBatches} batches...`
          );

          for (let i = 0; i < annotationsToCreate.length; i += BATCH_SIZE) {
            const batch = annotationsToCreate.slice(i, i + BATCH_SIZE);
            await tx.annotation.createMany({
              data: batch,
            });

            const currentBatch = Math.floor(i / BATCH_SIZE) + 1;
            console.log(
              `Processed batch ${currentBatch}/${totalBatches} (${batch.length} annotations)`
            );

            // Clear batch from memory
            batch.length = 0;

            // Small delay to prevent overwhelming the database
            if (currentBatch % 10 === 0) {
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
          }
        } else {
          await tx.annotation.createMany({
            data: annotationsToCreate,
          });
        }

        // Clear large arrays from memory
        annotationsToCreate.length = 0;
        imagesToCreate.length = 0;
        categoriesToCreate.length = 0;

        return dataset;
      },
      {
        timeout: 120000, // Increase timeout to 2 minutes for very large datasets
      }
    );

    console.log(
      `Successfully saved dataset ${result.id} with ${data.images.length} images and ${data.annotations.length} annotations`
    );

    return NextResponse.json(
      {
        message: "COCO JSON uploaded and saved successfully",
        datasetId: result.id,
        stats: {
          images: data.images.length,
          annotations: data.annotations.length,
          categories: data.categories.length,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Failed to process and save COCO JSON:", error);

    // Provide more specific error messages
    if (error instanceof Error) {
      // Check for specific Prisma errors
      if (error.message.includes("Transaction already closed")) {
        return NextResponse.json(
          {
            error:
              "Upload timeout - dataset too large. Try splitting into smaller batches.",
          },
          { status: 408 }
        );
      }

      if (
        error.message.includes("out of memory") ||
        error.message.includes("OOM")
      ) {
        return NextResponse.json(
          {
            error:
              "Out of memory error - dataset too large for current resources.",
          },
          { status: 507 }
        );
      }

      return NextResponse.json(
        { error: `Database error: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: "Invalid JSON or database error" },
      { status: 400 }
    );
  }
}
