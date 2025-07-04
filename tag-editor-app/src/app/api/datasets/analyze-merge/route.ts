import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

interface AnalyzeMergeRequest {
  sourceDatasetIds: number[];
  targetDatasetId?: number;
  mergeStrategy: "create_new" | "merge_into_existing";
  categoryMergeStrategy:
    | "keep_separate"
    | "merge_by_name"
    | "prefix_with_dataset";
}

interface CategoryConflict {
  categoryName: string;
  cocoId: number;
  datasets: Array<{
    datasetId: number;
    datasetName: string;
    categoryId: number;
    annotationCount: number;
  }>;
  suggestedAction: "merge" | "keep_separate" | "rename";
  reason: string;
}

export async function POST(request: Request) {
  try {
    const body: AnalyzeMergeRequest = await request.json();
    const {
      sourceDatasetIds,
      targetDatasetId,
      mergeStrategy,
      categoryMergeStrategy,
    } = body;

    // Get source datasets with categories and annotation counts
    const sourceDatasets = await prisma.dataset.findMany({
      where: { id: { in: sourceDatasetIds } },
      include: {
        categories: {
          include: {
            _count: {
              select: { annotations: true },
            },
          },
        },
      },
    });

    // Get target dataset categories if merging into existing
    let targetCategories: Array<{
      id: number;
      name: string;
      cocoId: number;
      datasetId: number;
      _count: { annotations: number };
    }> = [];
    if (mergeStrategy === "merge_into_existing" && targetDatasetId) {
      const targetDataset = await prisma.dataset.findUnique({
        where: { id: targetDatasetId },
        include: {
          categories: {
            include: {
              _count: {
                select: { annotations: true },
              },
            },
          },
        },
      });
      targetCategories = targetDataset?.categories || [];
    }

    // Analyze category conflicts
    const categoryMap = new Map<string, CategoryConflict>();

    // Create a unified category structure for analysis
    const allCategories: Array<{
      id: number;
      name: string;
      cocoId: number;
      datasetId: number;
      datasetName: string;
      annotationCount: number;
    }> = [];

    // Add target categories if merging into existing
    for (const category of targetCategories) {
      allCategories.push({
        id: category.id,
        name: category.name,
        cocoId: category.cocoId,
        datasetId: category.datasetId,
        datasetName: "Target Dataset",
        annotationCount: category._count.annotations,
      });
    }

    // Add all source categories to the analysis
    for (const dataset of sourceDatasets) {
      for (const category of dataset.categories) {
        allCategories.push({
          id: category.id,
          name: category.name,
          cocoId: category.cocoId,
          datasetId: dataset.id,
          datasetName: dataset.name || "Unnamed Dataset",
          annotationCount: category._count.annotations,
        });
      }
    }

    // Group categories by name and COCO ID to find conflicts
    for (const category of allCategories) {
      const key = `${category.name}_${category.cocoId}`;

      if (!categoryMap.has(key)) {
        categoryMap.set(key, {
          categoryName: category.name,
          cocoId: category.cocoId,
          datasets: [],
          suggestedAction: "merge",
          reason: "",
        });
      }

      const conflict = categoryMap.get(key)!;
      conflict.datasets.push({
        datasetId: category.datasetId,
        datasetName: category.datasetName,
        categoryId: category.id,
        annotationCount: category.annotationCount,
      });
    }

    // Determine suggested actions and reasons
    const conflicts: CategoryConflict[] = [];
    for (const [, conflict] of categoryMap) {
      if (conflict.datasets.length > 1) {
        // This is a conflict - same name/ID appears in multiple datasets
        const totalAnnotations = conflict.datasets.reduce(
          (sum, d) => sum + d.annotationCount,
          0
        );

        if (categoryMergeStrategy === "merge_by_name") {
          conflict.suggestedAction = "merge";
          conflict.reason = `Same category name "${conflict.categoryName}" found in ${conflict.datasets.length} datasets with ${totalAnnotations} total annotations. Suggested to merge.`;
        } else if (categoryMergeStrategy === "keep_separate") {
          conflict.suggestedAction = "keep_separate";
          conflict.reason = `Keep separate as requested. Will create prefixed categories.`;
        } else {
          conflict.suggestedAction = "rename";
          conflict.reason = `Category name conflict. Will prefix with dataset names.`;
        }

        conflicts.push(conflict);
      }
    }

    // Also find categories with same name but different COCO IDs
    const nameGroups = new Map<string, typeof allCategories>();
    for (const category of allCategories) {
      if (!nameGroups.has(category.name)) {
        nameGroups.set(category.name, []);
      }
      nameGroups.get(category.name)!.push(category);
    }

    const nameConflicts: CategoryConflict[] = [];
    for (const [name, categories] of nameGroups) {
      if (categories.length > 1) {
        const uniqueCocoIds = new Set(categories.map((c) => c.cocoId));
        if (uniqueCocoIds.size > 1) {
          // Same name, different COCO IDs
          nameConflicts.push({
            categoryName: name,
            cocoId: -1, // Multiple IDs
            datasets: categories.map((c) => ({
              datasetId: c.datasetId,
              datasetName: c.datasetName,
              categoryId: c.id,
              annotationCount: c.annotationCount,
            })),
            suggestedAction: "keep_separate",
            reason: `Same category name "${name}" with different COCO IDs (${Array.from(
              uniqueCocoIds
            ).join(", ")}). Recommended to keep separate or manually review.`,
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      analysis: {
        totalSourceDatasets: sourceDatasets.length,
        totalCategories: allCategories.length,
        exactMatches: conflicts.length,
        nameConflicts: nameConflicts.length,
        conflicts: [...conflicts, ...nameConflicts],
        datasets: sourceDatasets.map((d) => ({
          id: d.id,
          name: d.name,
          categoryCount: d.categories.length,
          categories: d.categories.map((c) => ({
            id: c.id,
            name: c.name,
            cocoId: c.cocoId,
            annotationCount: c._count.annotations,
          })),
        })),
      },
    });
  } catch (error) {
    console.error("Failed to analyze merge:", error);
    return NextResponse.json(
      {
        error: "Failed to analyze merge",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
