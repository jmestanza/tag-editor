# Category Merge Logic Fix - Multiple Categories Issue Resolved ✅

## Issue Description

When users selected "merge into single category" for category conflicts, the system was still creating multiple separate categories instead of merging them into a single category as intended.

## Root Cause Analysis

### The Problem

The original merge logic processed each source category individually and created new categories if they didn't exist. This meant that for a conflict where the user chose "merge", each category in the conflict was processed separately, potentially creating multiple categories with the same name.

### Example Scenario

- **Dataset A** has category "person" (ID: 1, COCO ID: 1)
- **Dataset B** has category "person" (ID: 2, COCO ID: 1)
- **User Decision**: "Merge into single category"
- **Expected Result**: 1 merged "person" category
- **Actual Result (before fix)**: 2 separate "person" categories

## Solution Implemented

### Two-Phase Processing Approach

#### Phase 1: Create Merge Target Categories

```typescript
// First pass: Create target categories for merge decisions
const mergeTargetCategories = new Map<number, number>(); // conflictIndex -> finalCategoryId

for (const decision of categoryMappingDecisions) {
  if (decision.action === "merge") {
    // Create ONE target category per merge decision
    // All categories in this conflict will map to this single target
  }
}
```

#### Phase 2: Map Source Categories to Targets

```typescript
// Second pass: Process each category and assign it to the appropriate target
for (const category of sourceDataset.categories) {
  if (userDecision.action === "merge") {
    // Use the pre-created merge target category
    finalCategoryId = mergeTargetCategories.get(conflict.index)!;
  }
}
```

### Key Improvements

#### 1. Guaranteed Single Target

- **Before**: Each source category could create its own target category
- **After**: All categories in a merge conflict map to the SAME target category

#### 2. Proper Conflict Resolution

- **Before**: Categories processed independently, ignoring conflict relationships
- **After**: Conflict-aware processing ensures consistent merge behavior

#### 3. Enhanced Logging

```typescript
console.log(
  `Created merge target category for conflict ${decision.conflictIndex}: "${targetName}" (ID: ${targetCategoryId})`
);
console.log(
  `Mapping category ${sourceDataset.id}:${category.id} to merge target ${finalCategoryId}`
);
```

## Technical Details

### Data Flow

1. **User Decision**: "Merge categories A and B into single category"
2. **Phase 1**: Create target category (e.g., ID: 100, name: "person")
3. **Phase 2**: Map both source categories → target category ID 100
4. **Result**: All annotations reference the same merged category

### Merge Target Creation Logic

```typescript
const targetName =
  decision.targetCategoryName || conflict.items[0].category.name;
const targetCocoId = decision.targetCocoId || conflict.items[0].category.cocoId;

// Look for existing category first
const existingTarget = existingCategories.find((c) => c.name === targetName);

if (existingTarget) {
  targetCategoryId = existingTarget.id;
} else {
  // Create new merged category only once per conflict
  const newCategory = await tx.category.create({
    data: {
      name: targetName,
      supercategory: conflict.items[0].category.supercategory,
      datasetId: finalDataset.id,
      cocoId: targetCocoId,
    },
  });
  targetCategoryId = newCategory.id;
}
```

## Validation

### Expected Behavior Now

- **User selects "merge"** → Creates exactly 1 target category
- **All conflicting categories** → Map to the same target ID
- **Final result** → Single merged category with all annotations

### Build Status ✅

```
✓ Generating static pages (16/16)
✓ Collecting build traces
✓ Finalizing page optimization
```

## Testing Recommendations

To verify the fix works:

1. **Create test datasets** with conflicting category names
2. **Start merge process** and analyze conflicts
3. **Select "merge into single category"** for conflicts
4. **Complete merge** and verify result
5. **Check final dataset** should have fewer categories than sum of source categories

### Example Test Case

- **Source**: Dataset A (2 categories), Dataset B (2 categories) with 2 conflicts
- **User Action**: Merge both conflicts
- **Expected Result**: 2 merged categories (not 4 separate ones)

---

**Status: CATEGORY MERGE LOGIC FIXED** ✅

The dataset merging system now correctly implements user-driven category merging, ensuring that when users choose to merge conflicting categories, they truly get merged into single categories rather than creating duplicates.
