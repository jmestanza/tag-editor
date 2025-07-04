import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getMinioClient, BUCKET_NAME } from "@/lib/minio";
import path from "path";

interface CategoryMappingDecision {
  conflictIndex: number;
  action: "merge" | "keep_separate" | "rename";
  targetCategoryName?: string;
  targetCocoId?: number;
  selectedSourceCategoryId?: number;
}

interface MergeRequest {
  sourceDatasetIds: number[];
  newDatasetName: string;
  newDatasetDescription?: string;
  mergeStrategy: "create_new";
  categoryMergeStrategy:
    | "keep_separate"
    | "merge_by_name"
    | "prefix_with_dataset";
  handleDuplicateImages:
    | "skip"
    | "rename"
    | "overwrite"
    | "keep_best_annotated";
  categoryMappingDecisions: CategoryMappingDecision[];
}

// Helper function to get content type from file extension
function getContentTypeFromExtension(extension: string): string {
  const ext = extension.toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

export async function POST(request: Request) {
  try {
    const body: MergeRequest = await request.json();
    const {
      sourceDatasetIds,
      newDatasetName,
      newDatasetDescription,
      categoryMergeStrategy,
      handleDuplicateImages,
    } = body;

    // Get source datasets with all their data
    const sourceDatasets = await prisma.dataset.findMany({
      where: { id: { in: sourceDatasetIds } },
      include: {
        categories: {
          include: {
            annotations: {
              include: {
                image: true,
              },
            },
          },
        },
        images: {
          include: {
            annotations: {
              include: {
                category: true,
              },
            },
          },
        },
      },
    });

    if (sourceDatasets.length !== sourceDatasetIds.length) {
      return NextResponse.json(
        { error: "Some source datasets not found" },
        { status: 404 }
      );
    }

    // Create the new merged dataset
    const newDataset = await prisma.dataset.create({
      data: {
        name: newDatasetName,
        description:
          newDatasetDescription ||
          `Merged dataset from: ${sourceDatasets
            .map((d) => d.name)
            .join(", ")}`,
      },
    });

    const statistics = {
      totalSourceDatasets: sourceDatasets.length,
      totalImagesProcessed: 0,
      totalCategoriesProcessed: 0,
      totalAnnotationsProcessed: 0,
      filesCopied: 0,
      filesCopyFailed: 0,
      copyErrors: [] as string[],
      thumbnailsCopied: 0,
      thumbnailsCopyFailed: 0,
      duplicateImagesFound: 0,
      annotationsCopied: 0,
      annotationsCopyFailed: 0,
      annotationsSkippedNoCategory: 0,
      annotationErrors: [] as string[],
    };

    const duplicateWarnings: Array<{
      fileName: string;
      count: number;
      datasets: string[];
      selectedDataset?: string;
      reason?: string;
    }> = [];

    // Track category mappings
    const categoryMappings = new Map<number, number>(); // old category id -> new category id
    const newCategoryMap = new Map<string, number>(); // category name -> new category id
    let nextCategoryCocoId = 1;
    let nextImageCocoId = 1;
    let nextAnnotationCocoId = 1;

    // Process categories first
    for (const dataset of sourceDatasets) {
      for (const category of dataset.categories) {
        let newCategoryId: number;

        if (categoryMergeStrategy === "merge_by_name") {
          // Check if we already have a category with this name
          if (newCategoryMap.has(category.name)) {
            newCategoryId = newCategoryMap.get(category.name)!;
          } else {
            // Create new category
            const newCategory = await prisma.category.create({
              data: {
                name: category.name,
                cocoId: nextCategoryCocoId++,
                datasetId: newDataset.id,
              },
            });
            newCategoryId = newCategory.id;
            newCategoryMap.set(category.name, newCategoryId);
          }
        } else if (categoryMergeStrategy === "prefix_with_dataset") {
          // Always create new category with dataset prefix
          const prefixedName = `${dataset.name || "dataset"}_${category.name}`;
          const newCategory = await prisma.category.create({
            data: {
              name: prefixedName,
              cocoId: nextCategoryCocoId++,
              datasetId: newDataset.id,
            },
          });
          newCategoryId = newCategory.id;
        } else {
          // keep_separate - create new category with original name but unique in new dataset
          let categoryName = category.name;
          let counter = 1;

          // Find a unique name
          while (newCategoryMap.has(categoryName)) {
            categoryName = `${category.name}_${counter}`;
            counter++;
          }

          const newCategory = await prisma.category.create({
            data: {
              name: categoryName,
              cocoId: nextCategoryCocoId++,
              datasetId: newDataset.id,
            },
          });
          newCategoryId = newCategory.id;
          newCategoryMap.set(categoryName, newCategoryId);
        }

        categoryMappings.set(category.id, newCategoryId);
        statistics.totalCategoriesProcessed++;
      }
    }

    // Process images and their files
    const imageNameMap = new Map<
      string,
      {
        image: (typeof sourceDatasets)[0]["images"][0];
        dataset: (typeof sourceDatasets)[0];
      }
    >();

    for (const dataset of sourceDatasets) {
      for (const image of dataset.images) {
        const fileName = image.filePath
          ? path.basename(image.filePath)
          : `image_${image.id}`;

        if (imageNameMap.has(fileName)) {
          // Duplicate image found
          const existing = imageNameMap.get(fileName)!;
          duplicateWarnings.push({
            fileName,
            count: 2,
            datasets: [
              existing.dataset.name || "Unnamed",
              dataset.name || "Unnamed",
            ],
            selectedDataset: dataset.name || "Unnamed",
            reason: `Using image from ${
              dataset.name || "Unnamed"
            } (latest processed)`,
          });
          statistics.duplicateImagesFound++;

          if (handleDuplicateImages === "skip") {
            continue;
          }
        }

        try {
          // Determine new file path
          let newFileName = fileName;
          let newThumbnailPath: string | null = null;

          if (
            handleDuplicateImages === "rename" &&
            imageNameMap.has(fileName)
          ) {
            const baseName = path.parse(fileName).name;
            const ext = path.parse(fileName).ext;
            newFileName = `${baseName}_${dataset.name || "dataset"}${ext}`;
          }

          const newFilePath = `dataset-${newDataset.id}/${newFileName}`;

          // Copy the actual file from source to destination in MinIO
          if (!image.filePath) {
            statistics.filesCopyFailed++;
            statistics.copyErrors.push(
              `Image ${fileName} has no file path - cannot copy`
            );
            continue;
          }

          try {
            const client = getMinioClient();

            // Get the original file from MinIO
            console.log(
              `Copying file from ${image.filePath} to ${newFilePath}`
            );
            const sourceStream = await client.getObject(
              BUCKET_NAME,
              image.filePath!
            );

            // Convert stream to buffer
            const chunks: Buffer[] = [];
            for await (const chunk of sourceStream) {
              chunks.push(chunk);
            }
            const fileBuffer = Buffer.concat(chunks);
            console.log(`File buffer size: ${fileBuffer.length} bytes`);

            // Put the file in the new location
            await client.putObject(
              BUCKET_NAME,
              newFilePath,
              fileBuffer,
              fileBuffer.length,
              {
                "Content-Type": getContentTypeFromExtension(
                  path.extname(newFileName)
                ),
              }
            );

            console.log(`Successfully copied file to ${newFilePath}`);
            statistics.filesCopied++;

            // Copy thumbnail if it exists
            const imageWithThumbnail = image as typeof image & {
              thumbnailPath?: string | null;
            };
            if (imageWithThumbnail.thumbnailPath) {
              try {
                const originalThumbnailPath =
                  imageWithThumbnail.thumbnailPath as string;

                // Generate new thumbnail path based on the new file path
                newThumbnailPath = newFilePath.replace(
                  /(\.[^.]+)$/,
                  "_thumb$1"
                );

                console.log(
                  `Copying thumbnail from ${originalThumbnailPath} to ${newThumbnailPath}`
                );
                const thumbnailStream = await client.getObject(
                  BUCKET_NAME,
                  originalThumbnailPath
                );
                const thumbnailChunks: Buffer[] = [];
                for await (const chunk of thumbnailStream) {
                  thumbnailChunks.push(chunk);
                }
                const thumbnailBuffer = Buffer.concat(thumbnailChunks);

                await client.putObject(
                  BUCKET_NAME,
                  newThumbnailPath,
                  thumbnailBuffer,
                  thumbnailBuffer.length,
                  {
                    "Content-Type": "image/jpeg", // Thumbnails are always JPEG
                  }
                );

                console.log(
                  `Successfully copied thumbnail to ${newThumbnailPath}`
                );
                statistics.thumbnailsCopied++;
              } catch (thumbnailError) {
                statistics.thumbnailsCopyFailed++;
                console.error(
                  `Failed to copy thumbnail for ${fileName}:`,
                  thumbnailError
                );
                newThumbnailPath = null; // Don't set thumbnail path if copy failed
              }
            }
          } catch (copyError) {
            statistics.filesCopyFailed++;
            statistics.copyErrors.push(
              `Failed to copy file ${fileName}: ${
                copyError instanceof Error ? copyError.message : "Unknown error"
              }`
            );
            continue; // Skip this image if file copy failed
          }

          // Create new image record
          const imageData: {
            fileName: string;
            filePath: string;
            width: number;
            height: number;
            cocoId: number;
            datasetId: number;
            thumbnailPath?: string | null;
          } = {
            fileName: newFileName,
            filePath: newFilePath,
            width: image.width,
            height: image.height,
            cocoId: nextImageCocoId++,
            datasetId: newDataset.id,
          };

          if (newThumbnailPath) {
            imageData.thumbnailPath = newThumbnailPath;
          }

          const newImage = await prisma.image.create({
            data: imageData,
          });

          // Copy annotations
          for (const annotation of image.annotations) {
            const newCategoryId = categoryMappings.get(annotation.categoryId);
            if (!newCategoryId) {
              statistics.annotationsSkippedNoCategory++;
              statistics.annotationErrors.push(
                `Annotation for image ${fileName} skipped - category not found`
              );
              continue;
            }

            try {
              await prisma.annotation.create({
                data: {
                  imageId: newImage.id,
                  categoryId: newCategoryId,
                  bbox: annotation.bbox,
                  area: annotation.area,
                  iscrowd: annotation.iscrowd,
                  datasetId: newDataset.id,
                  cocoId: nextAnnotationCocoId++,
                },
              });
              statistics.annotationsCopied++;
            } catch (error) {
              statistics.annotationsCopyFailed++;
              statistics.annotationErrors.push(
                `Failed to copy annotation for image ${fileName}: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`
              );
            }
          }

          statistics.totalImagesProcessed++;
          imageNameMap.set(fileName, { image, dataset });
        } catch (error) {
          statistics.filesCopyFailed++;
          statistics.copyErrors.push(
            `Failed to process image ${fileName}: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          );
        }
      }
    }

    statistics.totalAnnotationsProcessed =
      statistics.annotationsCopied + statistics.annotationsCopyFailed;

    return NextResponse.json({
      success: true,
      message: `Successfully merged ${sourceDatasets.length} datasets into "${newDatasetName}"`,
      datasetId: newDataset.id,
      statistics,
      duplicateWarnings,
    });
  } catch (error) {
    console.error("Failed to merge datasets:", error);
    return NextResponse.json(
      {
        error: "Failed to merge datasets",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
