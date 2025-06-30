# COCO Dataset Tag Editor

A web application for uploading, viewing, and editing COCO dataset annotations with advanced image tagging capabilities.

## Features

- **COCO JSON Upload**: Upload COCO format annotation files to create datasets
- **Image Upload**: Upload corresponding images for your datasets with MinIO storage
- **Visual Annotation Viewer**: View images with bounding box annotations overlaid
- **Interactive Image Viewer**: Zoom, pan, and navigate through image collections
- **Category Management**: Browse and manage annotation categories
- **Dataset Organization**: Organize multiple datasets with their respective images and annotations
- **Export Functionality**: Download edited annotations as COCO JSON files
- **Scalable Storage**: MinIO object storage integration for enterprise-grade file management
- **Real-time Updates**: Hot reload during development

## Architecture

- **Frontend**: Next.js 14 with TypeScript and Tailwind CSS
- **Backend**: Next.js API routes
- **Database**: PostgreSQL with Prisma ORM
- **File Storage**: MinIO S3-compatible object storage
- **Development**: Hot reload and modern development tools
- **Deployment**: Docker Compose for easy orchestration

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Git

### Setup

1. Clone the repository:

```bash
git clone <repository-url>
cd tag-editor
```

2. Copy the environment file and configure it:

```bash
cp .env.example .env
```

3. Edit the `.env` file with your desired configuration (the defaults work for local development).

4. Start the application:

```bash
docker-compose up -d
```

5. Access the application:
   - **Application**: http://localhost:3000
   - **MinIO Console**: http://localhost:9001
   - **Database**: localhost:5432

## Deployment

### Docker Compose (Recommended)

The easiest way to deploy is using Docker Compose:

```bash
# Production deployment
docker-compose up -d --build
```

### Vercel Deployment

For frontend-only deployment, the Next.js app can be deployed on Vercel:

1. Push your code to a Git repository
2. Connect your repository to [Vercel](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme)
3. Configure environment variables in Vercel dashboard
4. Deploy automatically

Check out the [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

### Environment Variables

All environment variables are now managed through the `.env` file. Key variables include:

#### Database Configuration

- `POSTGRES_USER`: PostgreSQL username
- `POSTGRES_PASSWORD`: PostgreSQL password
- `POSTGRES_DB`: PostgreSQL database name
- `DATABASE_URL`: Full database connection string

#### MinIO Configuration

- `MINIO_ROOT_USER`: MinIO root username
- `MINIO_ROOT_PASSWORD`: MinIO root password
- `MINIO_ENDPOINT`: MinIO server endpoint
- `MINIO_ACCESS_KEY`: MinIO access key
- `MINIO_SECRET_KEY`: MinIO secret key
- `MINIO_BUCKET_NAME`: S3 bucket name for images
- `MINIO_USE_SSL`: Whether to use SSL for MinIO connections

#### Application Configuration

- `NODE_ENV`: Application environment (development/production)

## Usage

### 1. Upload COCO JSON File

1. Click "Upload COCO JSON file" on the main page
2. Select your COCO format JSON file containing annotations
3. The system will parse and store:
   - Dataset metadata
   - Image information (filename, dimensions)
   - Categories and supercategories
   - Bounding box annotations

### 2. Upload Images

1. After uploading a COCO JSON file, select the dataset from the list
2. Click "Upload Images" in the dataset viewer
3. Select and upload the image files that correspond to the filenames in your COCO JSON
4. Images will be stored in MinIO and linked to their respective annotations

### 3. View and Edit Annotations

1. Once images are uploaded, navigate through them using the Previous/Next buttons
2. Each image displays:
   - Original image with bounding boxes overlaid
   - Color-coded categories
   - Annotation details in the sidebar
   - Image metadata and dimensions
   - Interactive zoom and pan capabilities

### 4. Export Dataset

1. Download your edited annotations as a COCO JSON file from the dataset viewer
2. Export includes all current annotations and metadata

## Development

### Prerequisites

- Node.js 18+ and npm
- Docker and Docker Compose
- Git
- PostgreSQL (or use Docker Compose setup)

### Local Development Setup

#### Option 1: Docker Compose (Recommended)

For full-stack development with all services:

```bash
# Clone the repository
git clone <repository-url>
cd tag-editor

# Copy and configure environment
cp .env.example .env
# Edit .env with your desired configuration (defaults work for local development)

# Start all services
docker-compose up -d

# Access the application at http://localhost:3000
```

#### Option 2: Local Development Server

For frontend development with hot reload:

```bash
# Clone and setup
git clone <repository-url>
cd tag-editor/tag-editor-app

# Install dependencies
npm install

# Start development server
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

### Database Management

### Database Management

Run Prisma migrations:

```bash
cd tag-editor-app

# Generate Prisma client after schema changes
npx prisma generate

# Create and apply migrations
npx prisma migrate dev
# or with custom name
npx prisma migrate dev --name "migration-description"

# Reset database (development only)
npx prisma migrate reset

# View database in Prisma Studio
npx prisma studio
```

### Building for Production

```bash
cd tag-editor-app
npm run build
npm start
```

This will start the Next.js development server at http://localhost:3000.

### Database Migrations

Run Prisma migrations:

```bash
cd tag-editor-app
npx prisma migrate dev
```

### Accessing Services

- **MinIO Console**: http://localhost:9001 (minioadmin/minioadmin123)
- **Database**: Connect to localhost:5432 with credentials from `.env`

## File Structure

```
tag-editor/
├── .env                    # Environment variables (not in git)
├── .env.example           # Environment variables template
├── docker-compose.yml     # Docker services configuration
├── README.md              # This file
└── tag-editor-app/        # Next.js application
    ├── src/
    │   ├── app/           # Next.js app directory
    │   │   ├── api/       # API routes
    │   │   │   ├── datasets/          # Dataset management API
    │   │   │   ├── upload-coco-json/  # COCO JSON upload API
    │   │   │   ├── upload-images/     # Image upload API
    │   │   │   ├── annotations/       # Annotation management
    │   │   │   ├── categories/        # Category management
    │   │   │   └── images/           # Image serving API
    │   │   ├── components/
    │   │   │   ├── DatasetViewer.tsx  # Main dataset display component
    │   │   │   ├── ImageViewer.tsx    # Image + annotations display
    │   │   │   └── ImageUpload.tsx    # Image upload component
    │   │   └── page.tsx               # Main application page
    │   └── lib/           # Utility libraries
    │       ├── prisma.ts  # Database client
    │       └── minio.ts   # MinIO client
    ├── prisma/            # Database schema and migrations
    │   ├── schema.prisma  # Database schema
    │   └── migrations/    # Database migrations
    ├── public/            # Static assets
    └── Dockerfile         # Container configuration
```

## Database Schema

The application uses PostgreSQL with Prisma ORM. Key models include:

- **Dataset**: Container for related images and annotations
- **Image**: Image metadata and file information with MinIO paths
- **Category**: Annotation categories (from COCO format)
- **Annotation**: Bounding box annotations linking images and categories

## API Endpoints

- `POST /api/upload-coco-json` - Upload and parse COCO JSON files
- `POST /api/upload-images` - Upload image files for a dataset
- `GET /api/datasets` - List all datasets
- `GET /api/datasets?id={id}` - Get specific dataset with full details
- `GET /api/datasets/[id]/export` - Export dataset as COCO JSON
- `GET /api/categories` - Get all categories
- `GET /api/annotations` - Get annotations for dataset
- `GET /api/images/[...path]` - Serve images from MinIO storage

## Next.js Resources

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

To learn more about Next.js, take a look at:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial
- [Next.js GitHub repository](https://github.com/vercel/next.js) - feedback and contributions welcome

## Recent Changes

### Environment Variables Migration

- All environment variables are now managed through a `.env` file in the root directory
- Docker Compose now references the `.env` file for configuration
- Added `.env.example` for easy setup

### File Cleanup

- Removed unused SVG files from `/public/` directory
- Removed legacy `/public/uploads/` directory (replaced by MinIO storage)
- Updated `.gitignore` to properly exclude environment files

### MinIO Integration

- Application now uses MinIO for scalable object storage
- Legacy local file storage paths are still supported for backward compatibility
- Automatic bucket initialization and policy configuration

## Troubleshooting

### Common Issues

1. **Images not displaying**: Ensure image filenames in the uploaded images match exactly the filenames in the COCO JSON file
2. **Port conflicts**: Make sure ports 3000, 5432, 9000, and 9001 are available
3. **Database connection**: Check that the DATABASE_URL in `.env` matches your PostgreSQL configuration
4. **MinIO access**: Verify MinIO credentials and endpoint configuration
5. **File uploads**: Ensure MinIO bucket is properly initialized and accessible
6. **Upload errors**: Check file permissions and MinIO connectivity

### Environment Variables

Create a `.env` file with the required configuration. All environment variables are managed through this file:

```bash
# Copy the example file
cp .env.example .env
```

Key variables include:

#### Database Configuration

- `POSTGRES_USER`: PostgreSQL username
- `POSTGRES_PASSWORD`: PostgreSQL password
- `POSTGRES_DB`: PostgreSQL database name
- `DATABASE_URL`: Full database connection string

#### MinIO Configuration

- `MINIO_ROOT_USER`: MinIO root username
- `MINIO_ROOT_PASSWORD`: MinIO root password
- `MINIO_ENDPOINT`: MinIO server endpoint
- `MINIO_ACCESS_KEY`: MinIO access key
- `MINIO_SECRET_KEY`: MinIO secret key
- `MINIO_BUCKET_NAME`: S3 bucket name for images
- `MINIO_USE_SSL`: Whether to use SSL for MinIO connections

#### Application Configuration

- `NODE_ENV`: Application environment (development/production)

### Logs

View application logs:

```bash
docker-compose logs tag-editor
```

View all service logs:

```bash
docker-compose logs
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test your changes
5. Submit a pull request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
