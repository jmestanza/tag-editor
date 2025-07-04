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
  handleDuplicateImages:
    | "skip"
    | "rename"
    | "overwrite"
    | "keep_best_annotated";
  categoryMappingDecisions?: Array<{
    conflictIndex: number;
    action: "merge" | "keep_separate" | "rename";
    targetCategoryName?: string;
    targetCocoId?: number;
    selectedSourceCategoryId?: number;
  }>;
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

// Helper function to create image record
async function createImageRecord(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  image: {
    id: number;
    fileName: string;
    width: number;
    height: number;
    dateCaptured: Date | null;
    license: number | null;
    cocoId: number;
    filePath: string | null;
    annotations: Array<{
      id: number;
      cocoId: number;
      bbox: number[];
      area: number;
      iscrowd: number;
      category: { id: number };
    }>;
  },
  sourceDataset: { id: number; name: string | null },
  finalDataset: { id: number },
  finalFileName: string,
  copiedFiles: Array<{ from: string; to: string }>,
  categoryMappings: Map<string, number>
): Promise<{
  success: number;
  failed: number;
  skippedNoCategory: number;
  errors: string[];
}> {
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
  const annotationCopyResults = {
    success: 0,
    failed: 0,
    skippedNoCategory: 0,
    errors: [] as string[],
  };
  for (const annotation of image.annotations) {
    const categoryMappingKey = `${sourceDataset.id}:${annotation.category.id}`;
    let newCategoryId = categoryMappings.get(categoryMappingKey);

    if (!newCategoryId) {
      // Try to handle missing category mapping
      console.warn(
        `Missing category mapping for ${categoryMappingKey}. Attempting to create missing category.`
      );

      try {
        // Check if the category exists in the source dataset but wasn't processed
        const missingCategory = await tx.category.findUnique({
          where: { id: annotation.category.id },
        });

        if (missingCategory && missingCategory.datasetId === sourceDataset.id) {
          // Category exists but wasn't in the categories list - create mapping now
          const newCategory = await tx.category.create({
            data: {
              name: `${sourceDataset.name || "Unknown"}_${
                missingCategory.name
              }`,
              supercategory: missingCategory.supercategory,
              datasetId: finalDataset.id,
              cocoId: missingCategory.cocoId + sourceDataset.id * 10000,
            },
          });
          newCategoryId = newCategory.id;
          categoryMappings.set(categoryMappingKey, newCategoryId);
          console.log(
            `Created missing category mapping: ${categoryMappingKey} -> ${newCategoryId}`
          );
        } else {
          // Category doesn't exist or belongs to different dataset - create a fallback
          console.warn(
            `Creating fallback category for missing category ID ${annotation.category.id} in dataset ${sourceDataset.id}`
          );
          const fallbackCategory = await tx.category.create({
            data: {
              name: `[MISSING]_${sourceDataset.name || "Unknown"}_CategoryID_${
                annotation.category.id
              }`,
              supercategory: null,
              datasetId: finalDataset.id,
              cocoId: annotation.category.id + sourceDataset.id * 10000,
            },
          });
          newCategoryId = fallbackCategory.id;
          categoryMappings.set(categoryMappingKey, newCategoryId);
          console.log(
            `Created fallback category for missing category: ${categoryMappingKey} -> ${newCategoryId} (name: ${fallbackCategory.name})`
          );
        }
      } catch (error) {
        annotationCopyResults.skippedNoCategory++;
        const errorMsg = `Failed to create missing category for annotation ${
          annotation.id
        } (category ${annotation.category.id}) in dataset ${
          sourceDataset.id
        } for image ${image.fileName}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`;
        annotationCopyResults.errors.push(errorMsg);
        console.error(errorMsg);
        continue; // Skip this annotation
      }
    }

    if (newCategoryId) {
      try {
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
        annotationCopyResults.success++;
      } catch (error) {
        annotationCopyResults.failed++;
        annotationCopyResults.errors.push(
          `Failed to copy annotation ${annotation.id} for image ${
            image.fileName
          }: ${error instanceof Error ? error.message : "Unknown error"}`
        );
        console.error(`Failed to copy annotation ${annotation.id}:`, error);
      }
    } else {
      // This should not happen anymore with the fallback mechanism above
      annotationCopyResults.skippedNoCategory++;
      const errorMsg = `Unexpected: No category mapping could be created for annotation ${annotation.id} (category ${annotation.category.id}) in dataset ${sourceDataset.id} for image ${image.fileName}`;
      annotationCopyResults.errors.push(errorMsg);
      console.error(errorMsg);
    }
  }

  return annotationCopyResults;
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
      categoryMappingDecisions = [],
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

    // Validate categoryMappingDecisions if provided
    if (categoryMappingDecisions && categoryMappingDecisions.length > 0) {
      for (const decision of categoryMappingDecisions) {
        if (
          typeof decision.conflictIndex !== "number" ||
          decision.conflictIndex < 0
        ) {
          return NextResponse.json(
            {
              error:
                "Invalid category mapping decision: conflictIndex must be a non-negative number",
            },
            { status: 400 }
          );
        }
        if (!["merge", "keep_separate", "rename"].includes(decision.action)) {
          return NextResponse.json(
            {
              error:
                "Invalid category mapping decision: action must be 'merge', 'keep_separate', or 'rename'",
            },
            { status: 400 }
          );
        }
      }
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

        // First, find any orphaned categories (referenced by annotations but not in categories list)
        console.log("=== CHECKING FOR ORPHANED CATEGORIES ===");
        const orphanedCategories = new Map<
          string,
          {
            id: number;
            name: string;
            cocoId: number;
            supercategory: string | null;
            datasetId: number;
          }
        >(); // datasetId:categoryId -> category

        for (const sourceDataset of sourceDatasets) {
          const referencedCategoryIds = new Set<number>();
          const existingCategoryIds = new Set(
            sourceDataset.categories.map((c) => c.id)
          );

          // Find all category IDs referenced by annotations
          for (const image of sourceDataset.images) {
            for (const annotation of image.annotations) {
              referencedCategoryIds.add(annotation.category.id);
            }
          }

          // Find orphaned category IDs (referenced but not in categories list)
          const orphanedIds = Array.from(referencedCategoryIds).filter(
            (id) => !existingCategoryIds.has(id)
          );

          if (orphanedIds.length > 0) {
            console.log(
              `Dataset ${sourceDataset.id} has orphaned category IDs:`,
              orphanedIds
            );

            // Try to find these categories in the database
            for (const orphanedId of orphanedIds) {
              try {
                const orphanedCategory = await tx.category.findUnique({
                  where: { id: orphanedId },
                });

                if (orphanedCategory) {
                  console.log(
                    `Found orphaned category ${orphanedId}: ${orphanedCategory.name} (from dataset ${orphanedCategory.datasetId})`
                  );
                  orphanedCategories.set(
                    `${sourceDataset.id}:${orphanedId}`,
                    orphanedCategory
                  );

                  // Add to the source dataset's categories list for processing
                  sourceDataset.categories.push(orphanedCategory);
                } else {
                  console.warn(
                    `Orphaned category ${orphanedId} not found in database for dataset ${sourceDataset.id}`
                  );
                }
              } catch (error) {
                console.error(
                  `Error finding orphaned category ${orphanedId}:`,
                  error
                );
              }
            }
          }
        }

        // Create a mapping decisions lookup for quick access
        const decisionLookup = new Map<
          string,
          (typeof categoryMappingDecisions)[0]
        >();
        for (const decision of categoryMappingDecisions) {
          decisionLookup.set(`conflict_${decision.conflictIndex}`, decision);
        }

        // Group categories by name and COCO ID to identify conflicts (same as analyze endpoint)
        const categoryConflictMap = new Map<
          string,
          Array<{
            category: (typeof sourceDatasets)[0]["categories"][0];
            dataset: (typeof sourceDatasets)[0];
          }>
        >();

        // First, analyze all categories to find conflicts
        for (const sourceDataset of sourceDatasets) {
          for (const category of sourceDataset.categories) {
            const conflictKey = `${category.name}_${category.cocoId}`;
            if (!categoryConflictMap.has(conflictKey)) {
              categoryConflictMap.set(conflictKey, []);
            }
            categoryConflictMap
              .get(conflictKey)!
              .push({ category, dataset: sourceDataset });
          }
        }

        // Convert conflict map to array with indices (matching analyze endpoint)
        const conflicts = Array.from(categoryConflictMap.entries())
          .filter(([, items]) => items.length > 1)
          .map(([key, items], index) => ({ key, items, index }));

        console.log(`Found ${conflicts.length} category conflicts`);
        if (categoryMappingDecisions.length > 0) {
          console.log(
            `Applying ${categoryMappingDecisions.length} user-provided category mapping decisions`
          );
        }

        // Validate that user decisions reference valid conflicts
        const invalidDecisions = categoryMappingDecisions.filter(
          (decision) => decision.conflictIndex >= conflicts.length
        );
        if (invalidDecisions.length > 0) {
          console.warn(
            `Warning: ${invalidDecisions.length} category mapping decisions reference non-existent conflicts and will be ignored`
          );
        }

        // Process each category, applying user decisions where available
        // First pass: Create target categories for merge decisions
        const mergeTargetCategories = new Map<number, number>(); // conflictIndex -> finalCategoryId

        for (const decision of categoryMappingDecisions) {
          if (decision.action === "merge") {
            const conflict = conflicts[decision.conflictIndex];
            if (!conflict) continue;

            const targetName =
              decision.targetCategoryName || conflict.items[0].category.name;
            const targetCocoId =
              decision.targetCocoId || conflict.items[0].category.cocoId;

            // Check if we already created this target category
            let targetCategoryId = mergeTargetCategories.get(
              decision.conflictIndex
            );

            if (!targetCategoryId) {
              // Look for existing category with same name
              const existingTarget = existingCategories.find(
                (c) => c.name === targetName
              );

              if (existingTarget) {
                targetCategoryId = existingTarget.id;
              } else {
                // Create the merged target category
                const newCategory = await tx.category.create({
                  data: {
                    name: targetName,
                    supercategory: conflict.items[0].category.supercategory,
                    datasetId: finalDataset.id,
                    cocoId: targetCocoId,
                  },
                });
                targetCategoryId = newCategory.id;
                existingCategories.push(newCategory);
              }

              mergeTargetCategories.set(
                decision.conflictIndex,
                targetCategoryId
              );
              console.log(
                `Created merge target category for conflict ${decision.conflictIndex}: "${targetName}" (ID: ${targetCategoryId})`
              );
            }
          }
        }

        // Second pass: Process each category and assign it to the appropriate target
        for (const sourceDataset of sourceDatasets) {
          console.log(
            `Processing categories for dataset ${sourceDataset.id} (${sourceDataset.name}):`,
            sourceDataset.categories.map((c) => `${c.id}:${c.name}`)
          );

          for (const category of sourceDataset.categories) {
            let finalCategoryId: number;

            // Check if this category is part of a conflict with user decision
            const conflictKey = `${category.name}_${category.cocoId}`;
            const conflict = conflicts.find((c) => c.key === conflictKey);
            const userDecision = conflict
              ? decisionLookup.get(`conflict_${conflict.index}`)
              : null;

            if (userDecision && conflict) {
              // Apply user's decision for this conflict
              console.log(
                `Applying user decision for conflict ${conflict.index}: ${userDecision.action} for category "${category.name}"`
              );

              switch (userDecision.action) {
                case "merge":
                  // Use the pre-created merge target category
                  finalCategoryId = mergeTargetCategories.get(conflict.index)!;
                  console.log(
                    `Mapping category ${sourceDataset.id}:${category.id} to merge target ${finalCategoryId}`
                  );
                  break;

                case "rename":
                  // User wants to rename this category
                  const renamedName =
                    userDecision.targetCategoryName ||
                    `${sourceDataset.name}_${category.name}`;
                  const existingRenamed = existingCategories.find(
                    (c) => c.name === renamedName
                  );

                  if (existingRenamed) {
                    finalCategoryId = existingRenamed.id;
                  } else {
                    const newCategory = await tx.category.create({
                      data: {
                        name: renamedName,
                        supercategory: category.supercategory,
                        datasetId: finalDataset.id,
                        cocoId:
                          userDecision.targetCocoId ||
                          category.cocoId + sourceDataset.id * 10000,
                      },
                    });
                    finalCategoryId = newCategory.id;
                    existingCategories.push(newCategory);
                  }
                  break;

                case "keep_separate":
                default:
                  // User wants to keep categories separate
                  const separateName = `${sourceDataset.name}_${category.name}`;
                  const existingSeparate = existingCategories.find(
                    (c) => c.name === separateName
                  );

                  if (existingSeparate) {
                    finalCategoryId = existingSeparate.id;
                  } else {
                    const newCategory = await tx.category.create({
                      data: {
                        name: separateName,
                        supercategory: category.supercategory,
                        datasetId: finalDataset.id,
                        cocoId: category.cocoId + sourceDataset.id * 10000,
                      },
                    });
                    finalCategoryId = newCategory.id;
                    existingCategories.push(newCategory);
                  }
                  break;
              }
            } else {
              // No user decision for this category, apply default strategy
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
            }

            categoryMappings.set(
              `${sourceDataset.id}:${category.id}`,
              finalCategoryId
            );
            console.log(
              `Mapped category ${sourceDataset.id}:${category.id} (${category.name}) -> ${finalCategoryId}`
            );
          }
        }

        // Debug: Check what categories are actually referenced by annotations
        for (const sourceDataset of sourceDatasets) {
          const referencedCategoryIds = new Set<number>();
          for (const image of sourceDataset.images) {
            for (const annotation of image.annotations) {
              referencedCategoryIds.add(annotation.category.id);
            }
          }
          console.log(
            `Dataset ${sourceDataset.id} has annotations referencing categories:`,
            Array.from(referencedCategoryIds).sort()
          );
          console.log(
            `Dataset ${sourceDataset.id} has actual categories:`,
            sourceDataset.categories.map((c) => c.id).sort()
          );
        }

        // Step 3: Merge images and handle duplicates
        const copiedFiles: Array<{ from: string; to: string }> = [];
        const duplicateWarnings: Array<{
          fileName: string;
          count: number;
          datasets: string[];
          selectedDataset?: string;
          reason?: string;
        }> = [];

        // Track annotation copying results
        const totalAnnotationResults = {
          success: 0,
          failed: 0,
          skippedNoCategory: 0,
          errors: [] as string[],
        };

        // First pass: identify all duplicate images and their annotation counts
        const imageGroups = new Map<
          string,
          Array<{
            image: (typeof sourceDatasets)[0]["images"][0];
            dataset: (typeof sourceDatasets)[0];
            annotationCount: number;
          }>
        >();

        for (const sourceDataset of sourceDatasets) {
          for (const image of sourceDataset.images) {
            if (!imageGroups.has(image.fileName)) {
              imageGroups.set(image.fileName, []);
            }
            imageGroups.get(image.fileName)!.push({
              image,
              dataset: sourceDataset,
              annotationCount: image.annotations.length,
            });
          }
        }

        // Process each image group
        for (const [fileName, imageGroup] of imageGroups) {
          if (imageGroup.length > 1) {
            // This is a duplicate image
            const duplicateWarning = {
              fileName,
              count: imageGroup.length,
              datasets: imageGroup.map(
                (item) => item.dataset.name || "Unnamed Dataset"
              ),
              selectedDataset: undefined as string | undefined,
              reason: undefined as string | undefined,
            };

            let selectedImage = imageGroup[0];
            const finalFileName = fileName;

            // Handle duplicate image strategy
            if (handleDuplicateImages === "rename") {
              // Rename all instances
              for (let i = 0; i < imageGroup.length; i++) {
                const item = imageGroup[i];
                let currentFileName = fileName;

                if (i > 0) {
                  const nameWithoutExt = fileName.replace(/\.[^/.]+$/, "");
                  const extension = fileName.split(".").pop();
                  currentFileName = `${nameWithoutExt}_${i + 1}.${extension}`;
                }

                await createImageRecord(
                  tx,
                  item.image,
                  item.dataset,
                  finalDataset,
                  currentFileName,
                  copiedFiles,
                  categoryMappings
                ).then((result) => {
                  totalAnnotationResults.success += result.success;
                  totalAnnotationResults.failed += result.failed;
                  totalAnnotationResults.skippedNoCategory +=
                    result.skippedNoCategory;
                  totalAnnotationResults.errors.push(...result.errors);
                });
              }

              duplicateWarning.reason = "All instances renamed and kept";
            } else if (handleDuplicateImages === "skip") {
              // Skip all duplicates after first one
              const existing = await tx.image.findFirst({
                where: {
                  datasetId: finalDataset.id,
                  fileName: fileName,
                },
              });

              if (existing) {
                duplicateWarning.reason =
                  "All instances skipped (already exists in target)";
                duplicateWarnings.push(duplicateWarning);
                continue;
              }

              // Keep only the first one
              selectedImage = imageGroup[0];
              duplicateWarning.selectedDataset =
                selectedImage.dataset.name || "Unnamed Dataset";
              duplicateWarning.reason = "First instance kept, others skipped";
            } else if (handleDuplicateImages === "keep_best_annotated") {
              // Smart selection: keep the one with most annotations
              selectedImage = imageGroup.reduce((best, current) => {
                if (current.annotationCount > best.annotationCount) {
                  return current;
                } else if (current.annotationCount === best.annotationCount) {
                  // If annotation counts are equal, prefer the one from the dataset with more total annotations
                  const bestDatasetTotalAnnotations =
                    best.dataset.images.reduce(
                      (sum, img) => sum + img.annotations.length,
                      0
                    );
                  const currentDatasetTotalAnnotations =
                    current.dataset.images.reduce(
                      (sum, img) => sum + img.annotations.length,
                      0
                    );
                  return currentDatasetTotalAnnotations >
                    bestDatasetTotalAnnotations
                    ? current
                    : best;
                }
                return best;
              });

              duplicateWarning.selectedDataset =
                selectedImage.dataset.name || "Unnamed Dataset";
              duplicateWarning.reason = `Selected from ${selectedImage.dataset.name} (${selectedImage.annotationCount} annotations)`;
            } else {
              // Default "overwrite" behavior: keep the first one (or last one to overwrite)
              selectedImage = imageGroup[imageGroup.length - 1]; // Keep the last one found (overwrite behavior)
              duplicateWarning.selectedDataset =
                selectedImage.dataset.name || "Unnamed Dataset";
              duplicateWarning.reason = `Last instance kept (overwrite mode)`;
            }

            duplicateWarnings.push(duplicateWarning);

            // Create the selected image record (unless we're renaming, which was handled above)
            if (handleDuplicateImages !== "rename") {
              await createImageRecord(
                tx,
                selectedImage.image,
                selectedImage.dataset,
                finalDataset,
                finalFileName,
                copiedFiles,
                categoryMappings
              ).then((result) => {
                totalAnnotationResults.success += result.success;
                totalAnnotationResults.failed += result.failed;
                totalAnnotationResults.skippedNoCategory +=
                  result.skippedNoCategory;
                totalAnnotationResults.errors.push(...result.errors);
              });
            }
          } else {
            // Single image, no duplicates
            const item = imageGroup[0];
            await createImageRecord(
              tx,
              item.image,
              item.dataset,
              finalDataset,
              fileName,
              copiedFiles,
              categoryMappings
            ).then((result) => {
              totalAnnotationResults.success += result.success;
              totalAnnotationResults.failed += result.failed;
              totalAnnotationResults.skippedNoCategory +=
                result.skippedNoCategory;
              totalAnnotationResults.errors.push(...result.errors);
            });
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
          duplicateWarnings,
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
            duplicateImagesFound: duplicateWarnings.length,
            annotationsCopied: totalAnnotationResults.success,
            annotationsCopyFailed: totalAnnotationResults.failed,
            annotationsSkippedNoCategory:
              totalAnnotationResults.skippedNoCategory,
            annotationErrors: totalAnnotationResults.errors,
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
      duplicateWarnings: result.duplicateWarnings,
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
