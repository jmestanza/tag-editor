'use client';

import React, { useState, useEffect } from 'react';

interface CategoryConflict {
  categoryName: string;
  cocoId: number;
  datasets: Array<{
    datasetId: number;
    datasetName: string;
    categoryId: number;
    annotationCount: number;
  }>;
  suggestedAction: "merge" | "keep_separate" | "rename";
  reason: string;
}

interface CategoryMappingDecision {
  conflictIndex: number;
  action: "merge" | "keep_separate" | "rename";
  targetCategoryName?: string;
  targetCocoId?: number;
  selectedSourceCategoryId?: number; // Which source category to use as the "primary" one
}

interface CategoryMappingManagerProps {
  conflicts: CategoryConflict[];
  onMappingComplete: (decisions: CategoryMappingDecision[]) => void;
  onBack: () => void;
}

export default function CategoryMappingManager({ 
  conflicts, 
  onMappingComplete, 
  onBack 
}: CategoryMappingManagerProps) {
  const [decisions, setDecisions] = useState<CategoryMappingDecision[]>([]);

  useEffect(() => {
    // Initialize decisions with suggested actions
    const initialDecisions = conflicts.map((conflict, index) => ({
      conflictIndex: index,
      action: conflict.suggestedAction,
      targetCategoryName: conflict.categoryName,
      targetCocoId: conflict.cocoId,
      selectedSourceCategoryId: conflict.datasets[0]?.categoryId, // Default to first one
    }));
    setDecisions(initialDecisions);
  }, [conflicts]);

  const updateDecision = (index: number, updates: Partial<CategoryMappingDecision>) => {
    setDecisions(prev => prev.map((decision, i) => 
      i === index ? { ...decision, ...updates } : decision
    ));
  };

  const validateDecisions = () => {
    const errors: string[] = [];
    
    decisions.forEach((decision, index) => {
      const conflict = conflicts[index];
      if (!conflict) return;
      
      if (decision.action === "rename" && (!decision.targetCategoryName || decision.targetCategoryName.trim() === "")) {
        errors.push(`Conflict ${index + 1} (${conflict.categoryName}): Custom name is required when renaming`);
      }
      
      if (decision.action === "merge" && !decision.selectedSourceCategoryId) {
        errors.push(`Conflict ${index + 1} (${conflict.categoryName}): Please select a primary source when merging`);
      }
    });
    
    return errors;
  };

  const handleSubmit = () => {
    const validationErrors = validateDecisions();
    if (validationErrors.length > 0) {
      alert("Please fix the following issues:\n\n" + validationErrors.join("\n"));
      return;
    }
    onMappingComplete(decisions);
  };

  if (conflicts.length === 0) {
    return (
      <div className="p-6 text-center">
        <div className="w-16 h-16 mx-auto mb-4 bg-green-100 rounded-full flex items-center justify-center">
          <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">No Category Conflicts</h3>
        <p className="text-gray-600 mb-4">All categories can be merged without conflicts.</p>
        <button
          onClick={() => onMappingComplete([])}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Proceed with Merge
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Category Mapping Configuration</h2>
        <p className="text-gray-600">
          Review and configure how categories should be handled during the merge. 
          We found {conflicts.length} category conflict(s) that need your attention.
        </p>
      </div>

      <div className="space-y-6">
        {conflicts.map((conflict, index) => {
          const decision = decisions[index];
          if (!decision) return null;

          return (
            <div key={index} className="bg-white border border-gray-200 rounded-lg p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-medium text-gray-900">
                    Category: &ldquo;{conflict.categoryName}&rdquo;
                  </h3>
                  <p className="text-sm text-gray-500">COCO ID: {conflict.cocoId}</p>
                </div>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                  Conflict
                </span>
              </div>

              <div className="mb-4">
                <p className="text-sm text-gray-600 mb-3">{conflict.reason}</p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
                  {conflict.datasets.map((dataset, dsIndex) => (
                    <div key={dsIndex} className="bg-gray-50 rounded-md p-3">
                      <div className="font-medium text-sm text-gray-900">{dataset.datasetName}</div>
                      <div className="text-xs text-gray-500">
                        Category ID: {dataset.categoryId}
                      </div>
                      <div className="text-xs text-gray-500">
                        Annotations: {dataset.annotationCount}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Resolution Strategy
                  </label>
                  <div className="space-y-2">
                    <label className="flex items-center">
                      <input
                        type="radio"
                        value="merge"
                        checked={decision.action === "merge"}
                        onChange={(e) => updateDecision(index, { action: e.target.value as "merge" | "keep_separate" | "rename" })}
                        className="mr-2"
                      />
                      <div>
                        <span className="text-sm font-medium">Merge into single category</span>
                        <p className="text-xs text-gray-500">Combine all instances into one category</p>
                      </div>
                    </label>
                    
                    <label className="flex items-center">
                      <input
                        type="radio"
                        value="keep_separate"
                        checked={decision.action === "keep_separate"}
                        onChange={(e) => updateDecision(index, { action: e.target.value as "merge" | "keep_separate" | "rename" })}
                        className="mr-2"
                      />
                      <div>
                        <span className="text-sm font-medium">Keep separate</span>
                        <p className="text-xs text-gray-500">Create separate categories with dataset prefixes</p>
                      </div>
                    </label>
                    
                    <label className="flex items-center">
                      <input
                        type="radio"
                        value="rename"
                        checked={decision.action === "rename"}
                        onChange={(e) => updateDecision(index, { action: e.target.value as "merge" | "keep_separate" | "rename" })}
                        className="mr-2"
                      />
                      <div>
                        <span className="text-sm font-medium">Rename manually</span>
                        <p className="text-xs text-gray-500">Provide a custom name for the merged category</p>
                      </div>
                    </label>
                  </div>
                </div>

                {decision.action === "merge" && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Select Primary Source
                      </label>
                      <p className="text-xs text-gray-500 mb-2">
                        Choose which dataset&apos;s category properties to use as the base
                      </p>
                      <select
                        value={decision.selectedSourceCategoryId}
                        onChange={(e) => updateDecision(index, { 
                          selectedSourceCategoryId: parseInt(e.target.value) 
                        })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                      >
                        {conflict.datasets.map((dataset) => (
                          <option key={dataset.categoryId} value={dataset.categoryId}>
                            {dataset.datasetName} (ID: {dataset.categoryId}, {dataset.annotationCount} annotations)
                          </option>
                        ))}
                      </select>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Final Category Name
                      </label>
                      <input
                        type="text"
                        value={decision.targetCategoryName}
                        onChange={(e) => updateDecision(index, { targetCategoryName: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                        placeholder="Category name"
                      />
                    </div>
                  </div>
                )}

                {decision.action === "rename" && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      New Category Name *
                    </label>
                    <input
                      type="text"
                      value={decision.targetCategoryName}
                      onChange={(e) => updateDecision(index, { targetCategoryName: e.target.value })}
                      className={`w-full px-3 py-2 border rounded-md text-sm ${
                        !decision.targetCategoryName || decision.targetCategoryName.trim() === ""
                          ? "border-red-300 bg-red-50"
                          : "border-gray-300"
                      }`}
                      placeholder="Enter new category name"
                    />
                    {(!decision.targetCategoryName || decision.targetCategoryName.trim() === "") && (
                      <p className="text-xs text-red-600 mt-1">Category name is required</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-between items-center mt-8 pt-6 border-t">
        <button
          onClick={onBack}
          className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
        >
          Back
        </button>
        
        <div className="flex space-x-3">
          <button
            onClick={handleSubmit}
            className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            title={validateDecisions().length > 0 ? "Please complete all required fields" : ""}
          >
            Apply Mapping & Continue Merge ({decisions.length} conflicts configured)
          </button>
        </div>
      </div>
    </div>
  );
}
