import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getMinioClient, BUCKET_NAME } from "@/lib/minio";

interface MergeRequest {
  sourceDatasetIds: number[];
  targetDatasetId?: number;
  newDatasetName?: string;
  newDatasetDescription?: string;
  mergeStrategy: "create_new" | "merge_into_existing";
  categoryMergeStrategy:
    | "keep_separate"
    | "merge_by_name"
    | "prefix_with_dataset";
  handleDuplicateImages: "skip" | "rename" | "overwrite";
}

// Helper function to check if thumbnail exists in MinIO
async function thumbnailExists(
  minioClient: ReturnType<typeof getMinioClient>,
  path: string
): Promise<boolean> {
  try {
    await minioClient.statObject(BUCKET_NAME, path);
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  try {
    const body: MergeRequest = await request.json();
    const {
      sourceDatasetIds,
      targetDatasetId,
      newDatasetName,
      newDatasetDescription,
      mergeStrategy,
      categoryMergeStrategy,
      handleDuplicateImages,
    } = body;

    // Validate input
    if (!sourceDatasetIds || sourceDatasetIds.length < 2) {
      return NextResponse.json(
        { error: "At least 2 source datasets are required for merging" },
        { status: 400 }
      );
    }

    if (mergeStrategy === "merge_into_existing" && !targetDatasetId) {
      return NextResponse.json(
        {
          error:
            "Target dataset ID is required when merging into existing dataset",
        },
        { status: 400 }
      );
    }

    if (mergeStrategy === "create_new" && !newDatasetName) {
      return NextResponse.json(
        { error: "New dataset name is required when creating new dataset" },
        { status: 400 }
      );
    }

    // Verify all source datasets exist
    const sourceDatasets = await prisma.dataset.findMany({
      where: { id: { in: sourceDatasetIds } },
      include: {
        images: {
          include: {
            annotations: {
              include: {
                category: true,
              },
            },
          },
        },
        categories: true,
      },
    });

    if (sourceDatasets.length !== sourceDatasetIds.length) {
      return NextResponse.json(
        { error: "One or more source datasets not found" },
        { status: 404 }
      );
    }

    // Verify target dataset exists if merging into existing
    let targetDataset = null;
    if (mergeStrategy === "merge_into_existing") {
      targetDataset = await prisma.dataset.findUnique({
        where: { id: targetDatasetId },
        include: {
          images: true,
          categories: true,
        },
      });

      if (!targetDataset) {
        return NextResponse.json(
          { error: "Target dataset not found" },
          { status: 404 }
        );
      }
    }

    // Start merge transaction
    const result = await prisma.$transaction(
      async (tx) => {
        let finalDataset;

        // Step 1: Create target dataset or use existing
        if (mergeStrategy === "create_new") {
          finalDataset = await tx.dataset.create({
            data: {
              name: newDatasetName!,
              description:
                newDatasetDescription ||
                `Merged from ${sourceDatasets.length} datasets: ${sourceDatasets
                  .map((d) => d.name)
                  .join(", ")}`,
            },
          });
        } else {
          finalDataset = targetDataset!;
        }

        // Step 2: Merge categories
        const categoryMappings = new Map<string, number>(); // Maps "datasetId:categoryId" to new category ID
        const existingCategories = await tx.category.findMany({
          where: { datasetId: finalDataset.id },
        });

        for (const sourceDataset of sourceDatasets) {
          for (const category of sourceDataset.categories) {
            let finalCategoryId: number;

            switch (categoryMergeStrategy) {
              case "keep_separate":
                // Create new category with dataset prefix
                const prefixedName = `${sourceDataset.name}_${category.name}`;
                const existingPrefixed = existingCategories.find(
                  (c) => c.name === prefixedName
                );

                if (existingPrefixed) {
                  finalCategoryId = existingPrefixed.id;
                } else {
                  const newCategory = await tx.category.create({
                    data: {
                      name: prefixedName,
                      supercategory: category.supercategory,
                      datasetId: finalDataset.id,
                      cocoId: category.cocoId + sourceDataset.id * 10000, // Ensure unique COCO IDs
                    },
                  });
                  finalCategoryId = newCategory.id;
                  existingCategories.push(newCategory);
                }
                break;

              case "merge_by_name":
                // Merge categories with same name
                const existingByName = existingCategories.find(
                  (c) => c.name === category.name
                );

                if (existingByName) {
                  finalCategoryId = existingByName.id;
                } else {
                  const newCategory = await tx.category.create({
                    data: {
                      name: category.name,
                      supercategory: category.supercategory,
                      datasetId: finalDataset.id,
                      cocoId: category.cocoId + sourceDataset.id * 10000, // Ensure unique COCO IDs
                    },
                  });
                  finalCategoryId = newCategory.id;
                  existingCategories.push(newCategory);
                }
                break;

              case "prefix_with_dataset":
                // Always prefix with dataset name
                const datasetPrefixedName = `[${sourceDataset.name}] ${category.name}`;
                const existingDatasetPrefixed = existingCategories.find(
                  (c) => c.name === datasetPrefixedName
                );

                if (existingDatasetPrefixed) {
                  finalCategoryId = existingDatasetPrefixed.id;
                } else {
                  const newCategory = await tx.category.create({
                    data: {
                      name: datasetPrefixedName,
                      supercategory: category.supercategory,
                      datasetId: finalDataset.id,
                      cocoId: category.cocoId + sourceDataset.id * 10000, // Ensure unique COCO IDs
                    },
                  });
                  finalCategoryId = newCategory.id;
                  existingCategories.push(newCategory);
                }
                break;
            }

            categoryMappings.set(
              `${sourceDataset.id}:${category.id}`,
              finalCategoryId
            );
          }
        }

        // Step 3: Merge images and handle duplicates
        const imageNameCounts = new Map<string, number>();
        const copiedFiles: Array<{ from: string; to: string }> = [];

        for (const sourceDataset of sourceDatasets) {
          for (const image of sourceDataset.images) {
            let finalFileName = image.fileName;

            // Handle duplicate image names
            if (handleDuplicateImages === "rename") {
              if (imageNameCounts.has(image.fileName)) {
                const count = imageNameCounts.get(image.fileName)! + 1;
                imageNameCounts.set(image.fileName, count);
                const nameWithoutExt = image.fileName.replace(/\.[^/.]+$/, "");
                const extension = image.fileName.split(".").pop();
                finalFileName = `${nameWithoutExt}_${count}.${extension}`;
              } else {
                imageNameCounts.set(image.fileName, 1);
              }
            } else if (handleDuplicateImages === "skip") {
              const existing = await tx.image.findFirst({
                where: {
                  datasetId: finalDataset.id,
                  fileName: image.fileName,
                },
              });

              if (existing) {
                continue; // Skip this image
              }
            }

            // Create new image record
            const newImage = await tx.image.create({
              data: {
                fileName: finalFileName,
                width: image.width,
                height: image.height,
                dateCaptured: image.dateCaptured,
                license: image.license,
                datasetId: finalDataset.id,
                cocoId: image.cocoId + sourceDataset.id * 100000, // Ensure unique COCO IDs
                filePath: image.filePath
                  ? `dataset-${finalDataset.id}/${finalFileName}`
                  : null,
              },
            });

            // Update thumbnail path if it exists using raw SQL since the type doesn't include it
            if (
              "thumbnailPath" in image &&
              (image as { thumbnailPath?: string }).thumbnailPath
            ) {
              await tx.$executeRaw`
              UPDATE "Image" 
              SET "thumbnailPath" = ${`dataset-${finalDataset.id}/thumbnails/${finalFileName}`}
              WHERE "id" = ${newImage.id}
            `;
            }

            // Copy file in MinIO if it exists
            if (image.filePath) {
              const newFilePath = `dataset-${finalDataset.id}/${finalFileName}`;
              copiedFiles.push({
                from: image.filePath,
                to: newFilePath,
              });
            }

            // Copy annotations with updated category references
            for (const annotation of image.annotations) {
              const newCategoryId = categoryMappings.get(
                `${sourceDataset.id}:${annotation.category.id}`
              );
              if (newCategoryId) {
                await tx.annotation.create({
                  data: {
                    imageId: newImage.id,
                    categoryId: newCategoryId,
                    bbox: annotation.bbox,
                    area: annotation.area,
                    iscrowd: annotation.iscrowd,
                    datasetId: finalDataset.id,
                    cocoId: annotation.cocoId + sourceDataset.id * 1000000, // Ensure unique COCO IDs
                  },
                });
              }
            }
          }
        }

        // Step 4: Copy files in MinIO
        const minioClient = getMinioClient();
        const copyResults = {
          success: 0,
          failed: 0,
          errors: [] as string[],
        };

        for (const copyOp of copiedFiles) {
          try {
            // Copy the file
            await minioClient.copyObject(
              BUCKET_NAME,
              copyOp.to,
              `/${BUCKET_NAME}/${copyOp.from}`
            );

            copyResults.success++;
          } catch (error) {
            copyResults.failed++;
            copyResults.errors.push(
              `Failed to copy ${copyOp.from} to ${copyOp.to}: ${
                error instanceof Error ? error.message : "Unknown error"
              }`
            );
          }
        }

        // Step 5: Copy thumbnails separately if they exist
        const thumbnailCopyResults = {
          success: 0,
          failed: 0,
        };

        for (const sourceDataset of sourceDatasets) {
          for (const image of sourceDataset.images) {
            // Check if original image has a thumbnail
            const originalThumbnailPath = (image as { thumbnailPath?: string })
              .thumbnailPath;
            if (originalThumbnailPath && image.filePath) {
              try {
                // Check if thumbnail actually exists before copying
                const thumbnailExistsInMinio = await thumbnailExists(
                  minioClient,
                  originalThumbnailPath
                );
                if (!thumbnailExistsInMinio) {
                  console.warn(
                    `Thumbnail ${originalThumbnailPath} not found in MinIO, skipping copy`
                  );
                  continue;
                }

                // Find the corresponding copied file to get the new filename
                const correspondingCopy = copiedFiles.find(
                  (copy) => copy.from === image.filePath
                );
                if (correspondingCopy) {
                  const newThumbnailPath = correspondingCopy.to.replace(
                    /^dataset-(\d+)\//,
                    "dataset-$1/thumbnails/"
                  );

                  await minioClient.copyObject(
                    BUCKET_NAME,
                    newThumbnailPath,
                    `/${BUCKET_NAME}/${originalThumbnailPath}`
                  );
                  thumbnailCopyResults.success++;
                }
              } catch (thumbError) {
                thumbnailCopyResults.failed++;
                console.warn(
                  `Failed to copy thumbnail from ${originalThumbnailPath}:`,
                  thumbError
                );
              }
            }
          }
        }

        return {
          dataset: finalDataset,
          statistics: {
            totalSourceDatasets: sourceDatasets.length,
            totalImagesProcessed: sourceDatasets.reduce(
              (sum, ds) => sum + ds.images.length,
              0
            ),
            totalCategoriesProcessed: sourceDatasets.reduce(
              (sum, ds) => sum + ds.categories.length,
              0
            ),
            totalAnnotationsProcessed: sourceDatasets.reduce(
              (sum, ds) =>
                sum +
                ds.images.reduce(
                  (imgSum, img) => imgSum + img.annotations.length,
                  0
                ),
              0
            ),
            filesCopied: copyResults.success,
            filesCopyFailed: copyResults.failed,
            copyErrors: copyResults.errors,
            thumbnailsCopied: thumbnailCopyResults.success,
            thumbnailsCopyFailed: thumbnailCopyResults.failed,
          },
        };
      },
      {
        timeout: 300000, // 5 minutes timeout for large merges
      }
    );

    return NextResponse.json({
      success: true,
      message: "Datasets merged successfully",
      datasetId: result.dataset.id,
      statistics: result.statistics,
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
