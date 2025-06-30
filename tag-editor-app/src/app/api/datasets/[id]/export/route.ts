import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

    // Fetch the dataset with all related data
    const dataset = await prisma.dataset.findUnique({
      where: { id: datasetId },
      include: {
        images: {
          include: {
            annotations: {
              include: {
                category: true,
              },
            },
          },
          orderBy: {
            dateCaptured: "asc",
          },
        },
        categories: true,
      },
    });

    if (!dataset) {
      return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
    }

    // Build COCO JSON format
    const cocoJson = {
      info: {
        description: dataset.description || dataset.name,
        url: "",
        version: "1.0",
        year: new Date().getFullYear(),
        contributor: "Tag Editor App",
        date_created: new Date().toISOString(),
      },
      licenses: [
        {
          id: 1,
          name: "Unknown License",
          url: "",
        },
      ],
      images: dataset.images.map((image) => ({
        id: image.cocoId,
        width: image.width,
        height: image.height,
        file_name: image.fileName,
        license: 1,
        flickr_url: "",
        coco_url: "",
        date_captured: new Date().toISOString(),
      })),
      annotations: dataset.images.flatMap((image) =>
        image.annotations.map((annotation) => ({
          id: annotation.cocoId,
          image_id: image.cocoId,
          category_id: annotation.category.cocoId,
          segmentation: [],
          area: annotation.area,
          bbox: annotation.bbox,
          iscrowd: annotation.iscrowd,
        }))
      ),
      categories: dataset.categories.map((category) => ({
        id: category.cocoId,
        name: category.name,
        supercategory: category.supercategory || "",
      })),
    };

    // Set response headers for file download
    const fileName = `${(dataset.name || "dataset")
      .replace(/[^a-z0-9]/gi, "_")
      .toLowerCase()}_annotations.json`;

    return new NextResponse(JSON.stringify(cocoJson, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    console.error("Failed to export dataset:", error);
    return NextResponse.json(
      { error: "Failed to export dataset" },
      { status: 500 }
    );
  }
}
