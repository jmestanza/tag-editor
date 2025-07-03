# Dataset Merge Feature

## Overview

The Dataset Merge feature allows you to combine multiple COCO datasets into a single dataset, with intelligent handling of categories, annotations, and image files. This is useful for:

- Combining datasets from different sources
- Merging training/validation/test splits
- Consolidating project data
- Creating larger datasets for machine learning

## Features

### Merge Strategies

1. **Create New Dataset**: Creates a completely new merged dataset
2. **Merge Into Existing**: Merges all source datasets into an existing target dataset

### Category Handling

1. **Merge by Name**: Categories with the same name are merged together
2. **Keep Separate**: Adds dataset name prefix to avoid conflicts (e.g., "DatasetA_person", "DatasetB_person")
3. **Always Prefix**: Always adds dataset name prefix (e.g., "[DatasetA] person", "[DatasetB] person")

### Duplicate Image Handling

1. **Rename**: Adds suffix to duplicate filenames (e.g., image.jpg → image_1.jpg, image_2.jpg)
2. **Skip**: Keeps first occurrence, ignores subsequent duplicates
3. **Overwrite**: Replaces existing files with new ones

## How to Use

1. **Access**: Click the "Merge Datasets" button in the main datasets view (appears when you have 2+ datasets)

2. **Select Datasets**: Choose at least 2 datasets to merge from the list

3. **Configure Settings**:

   - Choose merge strategy (new dataset vs existing)
   - Set category handling behavior
   - Configure duplicate image handling
   - Enter name/description for new dataset (if creating new)

4. **Execute Merge**: Review settings and start the merge process

5. **Review Results**: See detailed statistics about the merge operation

## API Endpoint

### POST /api/datasets/merge

Merges multiple datasets according to specified parameters.

**Request Body:**

```json
{
  "sourceDatasetIds": [1, 2, 3],
  "targetDatasetId": 4,  // Optional, for merge_into_existing
  "newDatasetName": "Merged Dataset",  // Optional, for create_new
  "newDatasetDescription": "Combined dataset description",  // Optional
  "mergeStrategy": "create_new" | "merge_into_existing",
  "categoryMergeStrategy": "keep_separate" | "merge_by_name" | "prefix_with_dataset",
  "handleDuplicateImages": "skip" | "rename" | "overwrite"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Datasets merged successfully",
  "datasetId": 5,
  "statistics": {
    "totalSourceDatasets": 3,
    "totalImagesProcessed": 1500,
    "totalCategoriesProcessed": 45,
    "totalAnnotationsProcessed": 12000,
    "filesCopied": 1480,
    "filesCopyFailed": 20,
    "copyErrors": ["Error messages..."]
  }
}
```

## Technical Implementation

### Database Operations

1. **Category Merging**: Creates new category records in target dataset with appropriate naming strategy
2. **Image Processing**: Creates new image records with updated file paths for target dataset
3. **Annotation Handling**: Updates all annotations to reference new category and image IDs
4. **COCO ID Management**: Generates unique COCO IDs to avoid conflicts

### File Operations

1. **MinIO Storage**: Copies image files and thumbnails to new dataset folder structure
2. **Path Updates**: Updates database file paths to point to new locations
3. **Error Handling**: Tracks and reports file copy failures

### Transaction Safety

- Uses database transactions to ensure data consistency
- Rolls back on failure to prevent partial merges
- 5-minute timeout for large dataset merges

## Limitations

1. **File Storage**: Requires sufficient MinIO storage space for copied files
2. **Processing Time**: Large datasets may take several minutes to merge
3. **Memory Usage**: Very large datasets may require increased server memory
4. **Network**: File copying depends on MinIO network performance

## Best Practices

1. **Backup**: Always backup datasets before merging (use export feature)
2. **Storage**: Ensure adequate storage space before starting large merges
3. **Naming**: Use descriptive names for merged datasets
4. **Categories**: Review category merge strategy carefully to avoid unexpected results
5. **Testing**: Test merge with small datasets first

## Troubleshooting

### Common Issues

1. **Out of Storage**: Increase MinIO storage or clean up unused files
2. **Timeout**: Increase transaction timeout for very large datasets
3. **Memory Issues**: Increase server memory allocation
4. **Category Conflicts**: Use "keep_separate" strategy to avoid naming conflicts

### Error Recovery

- Failed merges are automatically rolled back
- Check error messages in merge results
- Verify source datasets are intact after failed merge
- Retry with different settings if needed

## Examples

### Merging Training Datasets

```
Source: train_set_1 (1000 images), train_set_2 (800 images)
Strategy: Create new dataset "Combined Training Set"
Categories: Merge by name
Images: Rename duplicates
Result: 1800 images in new dataset
```

### Consolidating Project Data

```
Source: pilot_study, main_study, validation_study
Strategy: Create new dataset "Complete Study Dataset"
Categories: Prefix with dataset name
Images: Skip duplicates
Result: Consolidated dataset with clear category origins
```
