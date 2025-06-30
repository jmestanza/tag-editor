import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

interface Category {
  id: number;
  name: string;
  supercategory?: string;
}

interface Annotation {
  id: number;
  bbox: number[]; // [x, y, width, height]
  category: Category;
}

export async function PUT(req: Request) {
  try {
    const { imageId, annotations } = await req.json();

    if (!imageId || !annotations) {
      return NextResponse.json(
        { error: "Missing imageId or annotations" },
        { status: 400 }
      );
    }

    // Start a transaction to update annotations atomically
    const result = await prisma.$transaction(async (tx) => {
      // Get the current annotations for this image
      const existingAnnotations = await tx.annotation.findMany({
        where: { imageId: parseInt(imageId) },
        include: { category: true },
      });

      // Create maps for easier lookup
      const existingMap = new Map(
        existingAnnotations.map((ann) => [ann.id, ann])
      );
      const incomingMap = new Map(
        annotations.map((ann: Annotation) => [ann.id, ann])
      );

      // Find annotations to delete (exist in DB but not in incoming)
      const toDelete = existingAnnotations.filter(
        (ann) => !incomingMap.has(ann.id)
      );

      // Find annotations to update (exist in both)
      const toUpdate = annotations.filter(
        (ann: Annotation) =>
          existingMap.has(ann.id) && typeof ann.id === "number"
      );

      // Find annotations to create (new ones with temporary IDs)
      const toCreate = annotations.filter(
        (ann: Annotation) =>
          !existingMap.has(ann.id) || typeof ann.id !== "number"
      );

      // Delete annotations
      if (toDelete.length > 0) {
        await tx.annotation.deleteMany({
          where: {
            id: { in: toDelete.map((ann) => ann.id) },
          },
        });
      }

      // Update existing annotations
      for (const ann of toUpdate) {
        await tx.annotation.update({
          where: { id: ann.id },
          data: {
            bbox: ann.bbox,
            area: ann.bbox[2] * ann.bbox[3], // width * height
            // Note: We're not updating category for now, but could be added
          },
        });
      }

      // Create new annotations
      for (const ann of toCreate) {
        // Find or create category
        let category = await tx.category.findFirst({
          where: {
            name: ann.category.name,
            datasetId: existingAnnotations[0]?.datasetId,
          },
        });

        if (!category) {
          // Get the dataset ID from the image
          const image = await tx.image.findUnique({
            where: { id: parseInt(imageId) },
          });

          if (!image) {
            throw new Error(`Image with ID ${imageId} not found`);
          }

          // Get the next available cocoId for categories
          const maxCategoryCocoId = await tx.category.aggregate({
            where: { datasetId: image.datasetId },
            _max: { cocoId: true },
          });
          const nextCategoryCocoId = (maxCategoryCocoId._max.cocoId || 0) + 1;

          // Create new category
          category = await tx.category.create({
            data: {
              name: ann.category.name,
              datasetId: image.datasetId,
              cocoId: nextCategoryCocoId,
            },
          });
        }

        // Get the next available cocoId for annotations
        const maxAnnotationCocoId = await tx.annotation.aggregate({
          where: { datasetId: category.datasetId },
          _max: { cocoId: true },
        });
        const nextAnnotationCocoId = (maxAnnotationCocoId._max.cocoId || 0) + 1;

        await tx.annotation.create({
          data: {
            imageId: parseInt(imageId),
            categoryId: category.id,
            bbox: ann.bbox,
            area: ann.bbox[2] * ann.bbox[3], // width * height
            iscrowd: 0,
            datasetId: category.datasetId,
            cocoId: nextAnnotationCocoId,
          },
        });
      }

      // Return updated annotations
      return await tx.annotation.findMany({
        where: { imageId: parseInt(imageId) },
        include: { category: true },
      });
    });

    return NextResponse.json({
      success: true,
      annotations: result.map((ann) => ({
        id: ann.id,
        bbox: ann.bbox,
        category: {
          id: ann.category.id,
          name: ann.category.name,
          supercategory: ann.category.supercategory,
        },
      })),
    });
  } catch (error) {
    console.error("Error updating annotations:", error);
    return NextResponse.json(
      { error: "Failed to update annotations" },
      { status: 500 }
    );
  }
}
