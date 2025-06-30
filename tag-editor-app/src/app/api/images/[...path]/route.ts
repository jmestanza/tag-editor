import { NextRequest, NextResponse } from "next/server";
import { getMinioClient, BUCKET_NAME } from "@/lib/minio";

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { path } = await context.params;
    const objectPath = path.join("/");

    if (!objectPath) {
      return NextResponse.json(
        { error: "Object path is required" },
        { status: 400 }
      );
    }

    // Get object from MinIO
    const client = getMinioClient();
    const stream = await client.getObject(BUCKET_NAME, objectPath);

    // Convert stream to buffer
    const chunks: Buffer[] = [];

    return new Promise<NextResponse>((resolve, reject) => {
      stream.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });

      stream.on("end", () => {
        const buffer = Buffer.concat(chunks);

        // Determine content type based on file extension
        const extension = objectPath.split(".").pop()?.toLowerCase();
        let contentType = "application/octet-stream";

        switch (extension) {
          case "jpg":
          case "jpeg":
            contentType = "image/jpeg";
            break;
          case "png":
            contentType = "image/png";
            break;
          case "gif":
            contentType = "image/gif";
            break;
          case "webp":
            contentType = "image/webp";
            break;
          case "svg":
            contentType = "image/svg+xml";
            break;
        }

        resolve(
          new NextResponse(buffer, {
            headers: {
              "Content-Type": contentType,
              "Cache-Control": "public, max-age=31536000, immutable",
            },
          })
        );
      });

      stream.on("error", (error: Error) => {
        console.error("Error reading from MinIO:", error);
        reject(
          NextResponse.json({ error: "Failed to fetch image" }, { status: 500 })
        );
      });
    });
  } catch (error) {
    console.error("MinIO proxy error:", error);
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }
}
