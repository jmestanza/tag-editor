import { NextResponse } from "next/server";
import { deleteFromMinio, listObjects } from "@/lib/minio";

export async function POST(request: Request) {
  try {
    const { objectName } = await request.json();

    if (!objectName) {
      return NextResponse.json(
        { error: "objectName is required" },
        { status: 400 }
      );
    }

    console.log(`Testing deletion of object: ${objectName}`);

    // First, check if the object exists
    const allObjects = await listObjects();
    const objectExists = allObjects.includes(objectName);

    console.log(`Object exists in MinIO: ${objectExists}`);
    console.log(`All objects in bucket:`, allObjects);

    if (!objectExists) {
      return NextResponse.json({
        success: false,
        error: "Object does not exist in MinIO bucket",
        objectName,
        allObjects,
      });
    }

    // Try to delete the object
    await deleteFromMinio(objectName);

    // Verify deletion
    const objectsAfterDelete = await listObjects();
    const stillExists = objectsAfterDelete.includes(objectName);

    return NextResponse.json({
      success: !stillExists,
      message: stillExists
        ? "Object still exists after deletion attempt"
        : "Object successfully deleted",
      objectName,
      objectsBeforeDelete: allObjects.length,
      objectsAfterDelete: objectsAfterDelete.length,
      wasDeleted: !stillExists,
    });
  } catch (error) {
    console.error("Test MinIO deletion failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
