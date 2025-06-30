import { NextResponse } from "next/server";
import { getMinioClient, BUCKET_NAME } from "@/lib/minio";

export async function GET() {
  try {
    // Check if MinIO is accessible
    const client = getMinioClient();
    const bucketExists = await client.bucketExists(BUCKET_NAME);

    if (!bucketExists) {
      return NextResponse.json(
        {
          status: "error",
          message: `Bucket '${BUCKET_NAME}' does not exist`,
          minio: "accessible",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      status: "healthy",
      message: "MinIO connection successful",
      bucket: BUCKET_NAME,
      minio: "accessible",
    });
  } catch (error) {
    console.error("MinIO health check failed:", error);
    return NextResponse.json(
      {
        status: "error",
        message: "MinIO connection failed",
        error: error instanceof Error ? error.message : "Unknown error",
        minio: "inaccessible",
      },
      { status: 500 }
    );
  }
}
