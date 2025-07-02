import { Client as MinioClient, BucketItem } from "minio";

function getMinioConfig() {
  const endpoint = process.env.MINIO_ENDPOINT || "localhost:9000";
  const [host, port] = endpoint.split(":");

  return {
    endPoint: host,
    port: port ? parseInt(port, 10) : 9000,
    useSSL: process.env.MINIO_USE_SSL === "true",
    accessKey: process.env.MINIO_ACCESS_KEY || "minioadmin",
    secretKey: process.env.MINIO_SECRET_KEY || "minioadmin123",
  };
}

const bucketName = process.env.MINIO_BUCKET_NAME || "tag-editor-images";

// Lazy initialization to avoid build-time connection issues
let _minioClient: MinioClient | null = null;

export function getMinioClient(): MinioClient {
  if (!_minioClient) {
    _minioClient = new MinioClient(getMinioConfig());
  }
  return _minioClient;
}

export const BUCKET_NAME = bucketName;

// Initialize bucket if it doesn't exist
export async function initializeBucket() {
  try {
    const client = getMinioClient();
    const exists = await client.bucketExists(BUCKET_NAME);
    if (!exists) {
      await client.makeBucket(BUCKET_NAME);
      console.log(`Bucket '${BUCKET_NAME}' created successfully`);

      // Set bucket policy to allow public read access for images
      const policy = {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { AWS: ["*"] },
            Action: ["s3:GetObject"],
            Resource: [`arn:aws:s3:::${BUCKET_NAME}/*`],
          },
        ],
      };

      await client.setBucketPolicy(BUCKET_NAME, JSON.stringify(policy));
      console.log(`Public read policy set for bucket '${BUCKET_NAME}'`);
    }
  } catch (error) {
    console.error("Error initializing MinIO bucket:", error);
    throw error;
  }
}

// Upload file to MinIO
export async function uploadToMinio(
  objectName: string,
  buffer: Buffer,
  contentType: string = "application/octet-stream"
): Promise<string> {
  try {
    const client = getMinioClient();
    await client.putObject(BUCKET_NAME, objectName, buffer, buffer.length, {
      "Content-Type": contentType,
    });

    // Return the object name for internal use (we'll construct URLs as needed)
    return objectName;
  } catch (error) {
    console.error("Error uploading to MinIO:", error);
    throw error;
  }
}

// Get public URL for MinIO object via our proxy
export function getMinioProxyUrl(objectName: string): string {
  return `/api/images/${objectName}`;
}

// Get direct MinIO URL
export function getMinioDirectUrl(objectName: string): string {
  const endpoint = process.env.MINIO_ENDPOINT || "localhost:9000";
  return `http://${endpoint}/${BUCKET_NAME}/${objectName}`;
}

// Delete file from MinIO
export async function deleteFromMinio(objectName: string): Promise<void> {
  try {
    const client = getMinioClient();
    console.log(`Attempting to delete MinIO object: ${objectName}`);
    await client.removeObject(BUCKET_NAME, objectName);
    console.log(`Successfully deleted MinIO object: ${objectName}`);
  } catch (error) {
    console.error(`Error deleting from MinIO (object: ${objectName}):`, error);
    throw error;
  }
}

// Get presigned URL for private access (if needed)
export async function getPresignedUrl(
  objectName: string,
  expiry: number = 3600
): Promise<string> {
  try {
    const client = getMinioClient();
    return await client.presignedGetObject(BUCKET_NAME, objectName, expiry);
  } catch (error) {
    console.error("Error generating presigned URL:", error);
    throw error;
  }
}

// List objects in bucket with prefix
export async function listObjects(prefix?: string): Promise<string[]> {
  try {
    const client = getMinioClient();
    const objects: string[] = [];
    const stream = client.listObjects(BUCKET_NAME, prefix, true);

    return new Promise((resolve, reject) => {
      stream.on("data", (obj: BucketItem) => {
        if (obj.name) {
          objects.push(obj.name);
        }
      });

      stream.on("end", () => {
        resolve(objects);
      });

      stream.on("error", (err: Error) => {
        reject(err);
      });
    });
  } catch (error) {
    console.error("Error listing objects:", error);
    throw error;
  }
}
