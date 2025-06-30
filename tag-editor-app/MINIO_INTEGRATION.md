# MinIO Integration Guide

This document explains the MinIO bucket storage integration for the Tag Editor application.

## Overview

The application now uses MinIO as an S3-compatible object storage solution for storing uploaded images instead of the local filesystem. This provides better scalability, reliability, and supports distributed deployments.

## Setup and Configuration

### Environment Variables

The following environment variables control MinIO configuration:

```bash
MINIO_ENDPOINT=minio:9000          # MinIO server endpoint
MINIO_ACCESS_KEY=minioadmin        # MinIO access key
MINIO_SECRET_KEY=minioadmin123     # MinIO secret key
MINIO_BUCKET_NAME=tag-editor-images # Bucket name for storing images
MINIO_USE_SSL=false                # Whether to use SSL/HTTPS
```

### Docker Compose

The MinIO service is configured in `docker-compose.yml`:

```yaml
services:
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    ports:
      - "9000:9000" # MinIO API
      - "9001:9001" # MinIO Console UI
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin123
    volumes:
      - minio_data:/data
```

### Access MinIO Console

After starting the services, you can access the MinIO Console at:

- URL: http://localhost:9001
- Username: `minioadmin`
- Password: `minioadmin123`

## Image Upload Flow

1. **Client Upload**: Images are uploaded via the `/api/upload-images` endpoint
2. **MinIO Storage**: Images are stored in MinIO with the path pattern: `dataset-{datasetId}/{filename}`
3. **Database Update**: The `Image.filePath` field stores the MinIO object name
4. **Image Serving**: Images are served via the `/api/images/[...path]` proxy endpoint

## API Endpoints

### Upload Images

```
POST /api/upload-images
```

Uploads images to MinIO and updates the database with object names.

### Serve Images

```
GET /api/images/{objectPath}
```

Proxies image requests from MinIO, handling authentication and content type detection.

### Health Check

```
GET /api/health/minio
```

Checks MinIO connectivity and bucket availability.

## Migration from Local Storage

Images previously stored locally (with paths like `/uploads/{datasetId}/{filename}`) are automatically handled through fallback logic in the frontend:

1. If `filePath` starts with `/`, it's treated as a legacy local path
2. If `filePath` doesn't start with `/`, it's treated as a MinIO object name
3. If `filePath` is null, falls back to legacy path construction

## Object Storage Structure

```
tag-editor-images/
├── dataset-1/
│   ├── image1.jpg
│   ├── image2.png
│   └── ...
├── dataset-2/
│   ├── image1.jpg
│   └── ...
└── ...
```

## Benefits

1. **Scalability**: No local disk space limitations
2. **Reliability**: Built-in redundancy and backup capabilities
3. **Performance**: Distributed storage and caching
4. **Security**: Access control and encryption support
5. **Cloud Ready**: Easy migration to cloud object storage services

## Development

### Local Development

Start the services:

```bash
docker-compose up -d
```

The application will automatically:

1. Initialize the MinIO bucket if it doesn't exist
2. Set public read policies for image access
3. Handle both new MinIO uploads and legacy local files

### Testing MinIO Integration

1. Check MinIO health: `GET http://localhost:3000/api/health/minio`
2. Upload images through the UI
3. Verify images appear in MinIO Console
4. Confirm images display correctly in the application

## Troubleshooting

### Common Issues

1. **Connection Refused**: Ensure MinIO container is running
2. **Bucket Not Found**: Check if bucket initialization completed
3. **Images Not Loading**: Verify proxy endpoint and object paths
4. **Permission Denied**: Check MinIO access keys and bucket policies

### Debug Commands

```bash
# Check MinIO container logs
docker-compose logs minio

# Check app container logs
docker-compose logs tag-editor

# Test MinIO connectivity from app container
docker-compose exec tag-editor curl http://minio:9000/minio/health/live
```

## Production Considerations

1. **Security**: Change default MinIO credentials
2. **SSL/TLS**: Enable HTTPS for production deployments
3. **Backup**: Implement regular bucket backups
4. **Monitoring**: Set up MinIO monitoring and alerting
5. **Performance**: Consider MinIO clustering for high availability
