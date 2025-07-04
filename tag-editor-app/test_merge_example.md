# Dataset Merge Enhancement Test

## What was implemented:

1. **Duplicate Image Detection and Warnings**: The merge endpoint now tracks duplicate images across datasets and provides detailed warnings about them.

2. **Smart Duplicate Resolution**: When duplicates are found, the system can:

   - **Skip duplicates** (if `handleDuplicateImages` is set to "skip")
   - **Rename all instances** (if `handleDuplicateImages` is set to "rename")
   - **Overwrite with last instance** (if `handleDuplicateImages` is set to "overwrite")
   - **Keep the image with more annotations** (if `handleDuplicateImages` is set to "keep_best_annotated") ✨ NEW!

3. **Enhanced Response**: The API now returns:
   - `duplicateWarnings`: Array of duplicate image information
   - `statistics.duplicateImagesFound`: Count of duplicate images found

## Duplicate Handling Options:

- **`"skip"`**: Skip duplicate images after the first one is encountered
- **`"rename"`**: Rename all duplicate instances and keep them all (e.g., image.jpg, image_2.jpg, image_3.jpg)
- **`"overwrite"`**: Keep the last instance found (traditional overwrite behavior)
- **`"keep_best_annotated"`**: Intelligently select the version with the most annotations ✨

## Example Response:

```json
{
  "success": true,
  "message": "Datasets merged successfully",
  "datasetId": 123,
  "statistics": {
    "totalSourceDatasets": 3,
    "totalImagesProcessed": 150,
    "duplicateImagesFound": 5,
    "filesCopied": 145,
    "thumbnailsCopied": 120
  },
  "duplicateWarnings": [
    {
      "fileName": "image001.jpg",
      "count": 2,
      "datasets": ["Dataset A", "Dataset B"],
      "selectedDataset": "Dataset A",
      "reason": "Selected from Dataset A (5 annotations)"
    },
    {
      "fileName": "car_photo.png",
      "count": 3,
      "datasets": ["Dataset A", "Dataset B", "Dataset C"],
      "selectedDataset": "Dataset C",
      "reason": "Selected from Dataset C (8 annotations)"
    }
  ]
}
```

## Key Features of "keep_best_annotated" Mode:

- **Annotation-based Selection**: Automatically selects the version with the most annotations
- **Tie-breaking Logic**: If annotation counts are equal, it selects from the dataset with more total annotations
- **Comprehensive Warnings**: Each duplicate includes the filename, count, involved datasets, selected dataset, and reason for selection
- **Data Quality Focus**: Preserves the most valuable version of each image

## Testing:

To test this functionality, create a merge request with:

```json
{
  "sourceDatasetIds": [1, 2, 3],
  "mergeStrategy": "create_new",
  "newDatasetName": "Merged Dataset",
  "categoryMergeStrategy": "merge_by_name",
  "handleDuplicateImages": "keep_best_annotated"
}
```

The system will automatically select the version with more annotations and provide detailed warnings about the duplicates found.
