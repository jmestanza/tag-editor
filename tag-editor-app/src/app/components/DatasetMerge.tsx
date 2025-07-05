'use client';

import React, { useState, useEffect } from 'react';
import CategoryMappingManager from './CategoryMappingManager';

interface Dataset {
  id: number;
  name: string;
  description?: string;
  createdAt: string;
  _count: {
    images: number;
    categories: number;
  };
}

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
  selectedSourceCategoryId?: number;
}

interface MergeAnalysis {
  totalSourceDatasets: number;
  totalCategories: number;
  exactMatches: number;
  nameConflicts: number;
  conflicts: CategoryConflict[];
  datasets: Array<{
    id: number;
    name: string;
    categoryCount: number;
    categories: Array<{
      id: number;
      name: string;
      cocoId: number;
      annotationCount: number;
    }>;
  }>;
}

interface DatasetMergeProps {
  datasets: Dataset[];
  onMergeComplete: () => void;
  onClose: () => void;
}

interface MergeResult {
  success: boolean;
  message: string;
  datasetId?: number;
  mergeId?: string;
  statistics?: {
    totalSourceDatasets: number;
    totalImagesProcessed: number;
    totalCategoriesProcessed: number;
    totalAnnotationsProcessed: number;
    filesCopied: number;
    filesCopyFailed: number;
    copyErrors: string[];
    thumbnailsCopied: number;
    thumbnailsCopyFailed: number;
    duplicateImagesFound: number;
    annotationsCopied: number;
    annotationsCopyFailed: number;
    annotationsSkippedNoCategory: number;
    annotationErrors: string[];
  };
  duplicateWarnings?: Array<{
    fileName: string;
    count: number;
    datasets: string[];
    selectedDataset?: string;
    reason?: string;
  }>;
}

interface MergeProgress {
  total: number;
  current: number;
  currentOperation: string;
  percentage: number;
  errors: string[];
  completed: boolean;
  success?: boolean;
  result?: {
    datasetId?: number;
    statistics?: MergeResult['statistics'];
    duplicateWarnings?: MergeResult['duplicateWarnings'];
    error?: string;
  };
}

export default function DatasetMerge({ datasets, onMergeComplete, onClose }: DatasetMergeProps) {
  const [selectedDatasets, setSelectedDatasets] = useState<number[]>([]);
  const [newDatasetName, setNewDatasetName] = useState('');
  const [newDatasetDescription, setNewDatasetDescription] = useState('');
  const [categoryMergeStrategy, setCategoryMergeStrategy] = useState<'keep_separate' | 'merge_by_name' | 'prefix_with_dataset'>('merge_by_name');
  const [handleDuplicateImages, setHandleDuplicateImages] = useState<'skip' | 'rename' | 'overwrite' | 'keep_best_annotated'>('rename');
  const [isMerging, setIsMerging] = useState(false);
  const [mergeResult, setMergeResult] = useState<MergeResult | null>(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [mergeAnalysis, setMergeAnalysis] = useState<MergeAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [mergeProgress, setMergeProgress] = useState<MergeProgress | null>(null);
  const [currentMergeId, setCurrentMergeId] = useState<string | null>(null);

  // Auto-generate dataset name when datasets are selected
  useEffect(() => {
    if (selectedDatasets.length >= 2) {
      const selectedNames = selectedDatasets
        .map(id => datasets.find(d => d.id === id)?.name)
        .filter(Boolean);
      setNewDatasetName(`Merged: ${selectedNames.join(' + ')}`);
    }
  }, [selectedDatasets, datasets]);

  // Poll merge progress
  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    if (currentMergeId && isMerging) {
      intervalId = setInterval(async () => {
        try {
          const response = await fetch(`/api/datasets/merge-progress?mergeId=${currentMergeId}`);
          if (response.ok) {
            const progress: MergeProgress = await response.json();
            setMergeProgress(progress);

            if (progress.completed) {
              clearInterval(intervalId);
              setIsMerging(false);
              
              if (progress.success && progress.result) {
                setMergeResult({
                  success: true,
                  message: `Successfully merged datasets`,
                  datasetId: progress.result.datasetId,
                  mergeId: currentMergeId,
                  statistics: progress.result.statistics,
                  duplicateWarnings: progress.result.duplicateWarnings,
                });
                onMergeComplete();
              } else {
                setMergeResult({
                  success: false,
                  message: progress.result?.error || 'Merge failed',
                  mergeId: currentMergeId,
                });
              }
              setCurrentStep(4);
            }
          }
        } catch (error) {
          console.error('Failed to fetch merge progress:', error);
        }
      }, 1000); // Poll every second
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [currentMergeId, isMerging, onMergeComplete]);

  const handleDatasetToggle = (datasetId: number) => {
    setSelectedDatasets(prev => 
      prev.includes(datasetId) 
        ? prev.filter(id => id !== datasetId)
        : [...prev, datasetId]
    );
  };

  const getSelectedDatasetStats = () => {
    const selected = datasets.filter(d => selectedDatasets.includes(d.id));
    return {
      totalImages: selected.reduce((sum, d) => sum + d._count.images, 0),
      totalCategories: selected.reduce((sum, d) => sum + d._count.categories, 0),
      datasets: selected
    };
  };

  const canProceed = () => {
    if (selectedDatasets.length < 2) return false;
    if (!newDatasetName.trim()) return false;
    return true;
  };

  const resetForm = () => {
    setSelectedDatasets([]);
    setNewDatasetName('');
    setNewDatasetDescription('');
    setCategoryMergeStrategy('merge_by_name');
    setHandleDuplicateImages('rename');
    setMergeResult(null);
    setCurrentStep(1);
    setMergeAnalysis(null);
    setMergeProgress(null);
    setCurrentMergeId(null);
  };

  const handleAnalyzeMerge = async () => {
    if (selectedDatasets.length < 2) return;

    setIsAnalyzing(true);
    try {
      const response = await fetch('/api/datasets/analyze-merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceDatasetIds: selectedDatasets,
          mergeStrategy: 'create_new',
          categoryMergeStrategy,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to analyze merge');
      }

      const result = await response.json();
      setMergeAnalysis(result.analysis);
      
      // If there are conflicts, go to category mapping step
      if (result.analysis.conflicts.length > 0) {
        setCurrentStep(2.5); // Category mapping step
      } else {
        // No conflicts, proceed to merge
        setCurrentStep(3);
        performMerge([]);
      }
    } catch (error) {
      console.error('Analysis failed:', error);
      alert('Failed to analyze merge. Please try again.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleCategoryMappingComplete = (decisions: CategoryMappingDecision[]) => {
    setCurrentStep(3);
    performMerge(decisions);
  };

  const performMerge = async (categoryDecisions: CategoryMappingDecision[]) => {
    setIsMerging(true);
    setMergeProgress(null);
    setCurrentMergeId(null);
    
    try {
      const response = await fetch('/api/datasets/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceDatasetIds: selectedDatasets,
          newDatasetName,
          newDatasetDescription,
          mergeStrategy: 'create_new',
          categoryMergeStrategy,
          handleDuplicateImages,
          categoryMappingDecisions: categoryDecisions,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Merge failed');
      }

      // If the merge was successful and completed immediately (no progress tracking)
      if (result.success && !result.mergeId) {
        setMergeResult(result);
        setCurrentStep(4);
        onMergeComplete();
        setIsMerging(false);
      } else if (result.mergeId) {
        // Progress tracking is enabled, start polling
        setCurrentMergeId(result.mergeId);
        // The useEffect will handle the polling
      } else {
        // Handle error case
        setMergeResult({
          success: false,
          message: result.error || 'Unknown error occurred',
        });
        setCurrentStep(4);
        setIsMerging(false);
      }
    } catch (error) {
      console.error('Merge failed:', error);
      setMergeResult({
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      });
      setCurrentStep(4);
      setIsMerging(false);
    }
  };

  const stats = getSelectedDatasetStats();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b">
          <h2 className="text-2xl font-bold text-gray-900">Merge Datasets</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl"
          >
            ×
          </button>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center justify-center p-4 bg-gray-50 border-b">
          <div className="flex items-center space-x-4">
            <div className={`flex items-center ${currentStep >= 1 ? 'text-blue-600' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${currentStep >= 1 ? 'bg-blue-600 text-white' : 'bg-gray-300'}`}>
                1
              </div>
              <span className="ml-2 font-medium">Select</span>
            </div>
            <div className="w-8 h-px bg-gray-300"></div>
            <div className={`flex items-center ${currentStep >= 2 ? 'text-blue-600' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${currentStep >= 2 ? 'bg-blue-600 text-white' : 'bg-gray-300'}`}>
                2
              </div>
              <span className="ml-2 font-medium">Configure</span>
            </div>
            <div className="w-8 h-px bg-gray-300"></div>
            <div className={`flex items-center ${currentStep >= 3 ? 'text-orange-600' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${currentStep >= 3 ? 'bg-orange-600 text-white' : 'bg-gray-300'}`}>
                3
              </div>
              <span className="ml-2 font-medium">Merge</span>
            </div>
            <div className="w-8 h-px bg-gray-300"></div>
            <div className={`flex items-center ${currentStep >= 4 ? 'text-green-600' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${currentStep >= 4 ? 'bg-green-600 text-white' : 'bg-gray-300'}`}>
                4
              </div>
              <span className="ml-2 font-medium">Complete</span>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {currentStep === 1 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-4">Select Datasets to Merge</h3>
                <p className="text-gray-600 mb-4">
                  Choose at least 2 datasets to merge. All images, annotations, and categories will be combined.
                </p>
                
                <div className="grid gap-3 max-h-96 overflow-y-auto">
                  {datasets.map((dataset) => (
                    <div
                      key={dataset.id}
                      className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                        selectedDatasets.includes(dataset.id)
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                      onClick={() => handleDatasetToggle(dataset.id)}
                    >
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          checked={selectedDatasets.includes(dataset.id)}
                          onChange={() => handleDatasetToggle(dataset.id)}
                          className="mr-3"
                        />
                        <div className="flex-1">
                          <h4 className="font-medium text-gray-900">{dataset.name || 'Unnamed Dataset'}</h4>
                          {dataset.description && (
                            <p className="text-sm text-gray-600 mt-1">{dataset.description}</p>
                          )}
                          <div className="flex gap-4 mt-2 text-sm text-gray-500">
                            <span>{dataset._count.images} images</span>
                            <span>{dataset._count.categories} categories</span>
                            <span>Created {new Date(dataset.createdAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {selectedDatasets.length >= 2 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h4 className="font-semibold text-blue-900 mb-2">Selected Datasets Summary</h4>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="font-medium text-blue-700">Datasets:</span>
                      <div className="text-blue-900">{selectedDatasets.length}</div>
                    </div>
                    <div>
                      <span className="font-medium text-blue-700">Total Images:</span>
                      <div className="text-blue-900">{stats.totalImages}</div>
                    </div>
                    <div>
                      <span className="font-medium text-blue-700">Total Categories:</span>
                      <div className="text-blue-900">{stats.totalCategories}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {currentStep === 2 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-4">Configure Merge Settings</h3>
                
                {/* New Dataset Form */}
                <div className="space-y-4">
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        New Dataset Name *
                      </label>
                      <input
                        type="text"
                        value={newDatasetName}
                        onChange={(e) => setNewDatasetName(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Enter name for merged dataset"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Description (optional)
                      </label>
                      <textarea
                        value={newDatasetDescription}
                        onChange={(e) => setNewDatasetDescription(e.target.value)}
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Enter description for merged dataset"
                      />
                    </div>
                  </div>

                  {/* Category Merge Strategy */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Category Handling
                    </label>
                    <div className="space-y-2">
                      <label className="flex items-start">
                        <input
                          type="radio"
                          value="merge_by_name"
                          checked={categoryMergeStrategy === 'merge_by_name'}
                          onChange={(e) => setCategoryMergeStrategy(e.target.value as 'merge_by_name' | 'keep_separate' | 'prefix_with_dataset')}
                          className="mr-2 mt-0.5"
                        />
                        <div>
                          <span>Merge categories by name</span>
                          <p className="text-xs text-gray-500">Categories with the same name will be merged together</p>
                        </div>
                      </label>
                      <label className="flex items-start">
                        <input
                          type="radio"
                          value="keep_separate"
                          checked={categoryMergeStrategy === 'keep_separate'}
                          onChange={(e) => setCategoryMergeStrategy(e.target.value as 'merge_by_name' | 'keep_separate' | 'prefix_with_dataset')}
                          className="mr-2 mt-0.5"
                        />
                        <div>
                          <span>Keep categories separate</span>
                          <p className="text-xs text-gray-500">Add dataset name as prefix to avoid conflicts</p>
                        </div>
                      </label>
                      <label className="flex items-start">
                        <input
                          type="radio"
                          value="prefix_with_dataset"
                          checked={categoryMergeStrategy === 'prefix_with_dataset'}
                          onChange={(e) => setCategoryMergeStrategy(e.target.value as 'merge_by_name' | 'keep_separate' | 'prefix_with_dataset')}
                          className="mr-2 mt-0.5"
                        />
                        <div>
                          <span>Always prefix with dataset name</span>
                          <p className="text-xs text-gray-500">Format: [Dataset Name] Category Name</p>
                        </div>
                      </label>
                    </div>
                  </div>

                  {/* Duplicate Image Handling */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Duplicate Image Handling
                    </label>
                    <div className="space-y-2">
                      <label className="flex items-start">
                        <input
                          type="radio"
                          value="rename"
                          checked={handleDuplicateImages === 'rename'}
                          onChange={(e) => setHandleDuplicateImages(e.target.value as 'skip' | 'rename' | 'overwrite' | 'keep_best_annotated')}
                          className="mr-2 mt-0.5"
                        />
                        <div>
                          <span>Rename duplicates</span>
                          <p className="text-xs text-gray-500">Add suffix to filename (e.g., image_1.jpg, image_2.jpg)</p>
                        </div>
                      </label>
                      <label className="flex items-start">
                        <input
                          type="radio"
                          value="skip"
                          checked={handleDuplicateImages === 'skip'}
                          onChange={(e) => setHandleDuplicateImages(e.target.value as 'skip' | 'rename' | 'overwrite' | 'keep_best_annotated')}
                          className="mr-2 mt-0.5"
                        />
                        <div>
                          <span>Skip duplicates</span>
                          <p className="text-xs text-gray-500">Keep first occurrence, skip subsequent ones</p>
                        </div>
                      </label>
                      <label className="flex items-start">
                        <input
                          type="radio"
                          value="overwrite"
                          checked={handleDuplicateImages === 'overwrite'}
                          onChange={(e) => setHandleDuplicateImages(e.target.value as 'skip' | 'rename' | 'overwrite' | 'keep_best_annotated')}
                          className="mr-2 mt-0.5"
                        />
                        <div>
                          <span>Overwrite duplicates</span>
                          <p className="text-xs text-gray-500">Replace existing files with new ones</p>
                        </div>
                      </label>
                      <label className="flex items-start">
                        <input
                          type="radio"
                          value="keep_best_annotated"
                          checked={handleDuplicateImages === 'keep_best_annotated'}
                          onChange={(e) => setHandleDuplicateImages(e.target.value as 'skip' | 'rename' | 'overwrite' | 'keep_best_annotated')}
                          className="mr-2 mt-0.5"
                        />
                        <div>
                          <span>Keep best annotated</span>
                          <p className="text-xs text-gray-500">Automatically select the version with most annotations</p>
                        </div>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {currentStep === 2.5 && mergeAnalysis && (
            <CategoryMappingManager
              conflicts={mergeAnalysis.conflicts}
              onMappingComplete={handleCategoryMappingComplete}
              onBack={() => setCurrentStep(2)}
            />
          )}

          {currentStep === 3 && !mergeResult && (
            <div className="space-y-6">
              <div className="text-center">
                <h3 className="text-lg font-semibold mb-4">Merging Datasets</h3>
                <p className="text-gray-600 mb-6">
                  Please wait while we merge your selected datasets. This process may take a few minutes depending on the size of your datasets.
                </p>
              </div>

              {mergeProgress && (
                <div className="max-w-2xl mx-auto space-y-4">
                  {/* Progress Bar */}
                  <div className="bg-gray-200 rounded-full h-3 overflow-hidden">
                    <div 
                      className="bg-blue-600 h-full transition-all duration-300 ease-out"
                      style={{ width: `${Math.min(mergeProgress.percentage, 100)}%` }}
                    ></div>
                  </div>
                  
                  {/* Progress Text */}
                  <div className="text-center space-y-2">
                    <div className="font-medium text-gray-900">
                      {mergeProgress.percentage}% Complete
                    </div>
                    <div className="text-sm text-gray-600">
                      {mergeProgress.currentOperation}
                    </div>
                    <div className="text-xs text-gray-500">
                      Step {mergeProgress.current} of {mergeProgress.total}
                    </div>
                  </div>

                  {/* Error Messages */}
                  {mergeProgress.errors.length > 0 && (
                    <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                      <div className="text-sm font-medium text-yellow-800 mb-2">
                        Warnings:
                      </div>
                      <div className="text-xs text-yellow-700 space-y-1">
                        {mergeProgress.errors.map((error, index) => (
                          <div key={index}>• {error}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!mergeProgress && (
                <div className="text-center">
                  <div className="inline-flex items-center gap-3 text-gray-600">
                    <svg className="animate-spin h-6 w-6" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Initializing merge process...
                  </div>
                </div>
              )}
            </div>
          )}

          {currentStep >= 3 && mergeResult && (
            <div className="space-y-6">
              <div className={`text-center p-6 rounded-lg ${
                mergeResult.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
              }`}>
                <div className={`w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center ${
                  mergeResult.success ? 'bg-green-200' : 'bg-red-200'
                }`}>
                  {mergeResult.success ? (
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                </div>
                <h3 className="text-xl font-semibold mb-2">
                  {mergeResult.success ? 'Merge Completed Successfully!' : 'Merge Failed'}
                </h3>
                <p className="text-sm">{mergeResult.message}</p>
              </div>

              {mergeResult.success && mergeResult.statistics && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="font-semibold text-gray-900 mb-3">Merge Statistics</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="font-medium text-gray-700">Source Datasets:</span>
                      <div className="text-gray-900">{mergeResult.statistics.totalSourceDatasets}</div>
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Images Processed:</span>
                      <div className="text-gray-900">{mergeResult.statistics.totalImagesProcessed}</div>
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Categories Processed:</span>
                      <div className="text-gray-900">{mergeResult.statistics.totalCategoriesProcessed}</div>
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Annotations Processed:</span>
                      <div className="text-gray-900">{mergeResult.statistics.totalAnnotationsProcessed}</div>
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Files Copied:</span>
                      <div className="text-gray-900">{mergeResult.statistics.filesCopied}</div>
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Copy Failures:</span>
                      <div className={mergeResult.statistics.filesCopyFailed > 0 ? "text-red-600" : "text-gray-900"}>
                        {mergeResult.statistics.filesCopyFailed}
                      </div>
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Thumbnails Copied:</span>
                      <div className="text-gray-900">{mergeResult.statistics.thumbnailsCopied}</div>
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Thumbnail Failures:</span>
                      <div className={mergeResult.statistics.thumbnailsCopyFailed > 0 ? "text-orange-600" : "text-gray-900"}>
                        {mergeResult.statistics.thumbnailsCopyFailed}
                      </div>
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Duplicate Images:</span>
                      <div className={mergeResult.statistics.duplicateImagesFound > 0 ? "text-blue-600" : "text-gray-900"}>
                        {mergeResult.statistics.duplicateImagesFound}
                      </div>
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Annotations Copied:</span>
                      <div className="text-gray-900">{mergeResult.statistics.annotationsCopied}</div>
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Annotation Failures:</span>
                      <div className={mergeResult.statistics.annotationsCopyFailed > 0 ? "text-red-600" : "text-gray-900"}>
                        {mergeResult.statistics.annotationsCopyFailed}
                      </div>
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Annotations Skipped:</span>
                      <div className={mergeResult.statistics.annotationsSkippedNoCategory > 0 ? "text-orange-600" : "text-gray-900"}>
                        {mergeResult.statistics.annotationsSkippedNoCategory}
                      </div>
                    </div>
                  </div>

                  {/* Duplicate Warnings Section */}
                  {mergeResult.duplicateWarnings && mergeResult.duplicateWarnings.length > 0 && (
                    <div className="mt-4">
                      <h5 className="font-medium text-blue-700 mb-2">Duplicate Images Found:</h5>
                      <div className="max-h-48 overflow-y-auto space-y-2">
                        {mergeResult.duplicateWarnings.map((warning, index) => (
                          <div key={index} className="bg-blue-50 border border-blue-200 rounded-md p-3">
                            <div className="flex items-start">
                              <svg className="w-5 h-5 text-blue-400 mt-0.5 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <div className="flex-1 min-w-0">
                                <h6 className="font-medium text-blue-800 text-sm">{warning.fileName}</h6>
                                <p className="text-xs text-blue-700 mt-1">
                                  Found in {warning.count} datasets: {warning.datasets.join(', ')}
                                </p>
                                {warning.selectedDataset && warning.reason && (
                                  <p className="text-xs text-blue-600 mt-1">
                                    ✓ {warning.reason}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {mergeResult.statistics.copyErrors.length > 0 && (
                    <div className="mt-4">
                      <h5 className="font-medium text-red-700 mb-2">Copy Errors:</h5>
                      <div className="max-h-32 overflow-y-auto text-xs text-red-600 space-y-1">
                        {mergeResult.statistics.copyErrors.map((error, index) => (
                          <div key={index}>{error}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  {mergeResult.statistics.annotationErrors.length > 0 && (
                    <div className="mt-4">
                      <h5 className="font-medium text-red-700 mb-2">Annotation Errors:</h5>
                      <div className="max-h-32 overflow-y-auto text-xs text-red-600 space-y-1">
                        {mergeResult.statistics.annotationErrors.map((error, index) => (
                          <div key={index}>{error}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  {mergeResult.statistics.thumbnailsCopyFailed > 0 && (
                    <div className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded-md">
                      <div className="flex items-start">
                        <svg className="w-5 h-5 text-orange-400 mt-0.5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.232 16.5c-.77.833.192 2.5 1.732 2.5z" />
                        </svg>
                        <div>
                          <h6 className="font-medium text-orange-800">Missing Thumbnails</h6>
                          <p className="text-sm text-orange-700 mt-1">
                            Some thumbnails could not be copied. You can generate new thumbnails for the merged dataset by using the &quot;Generate Thumbnails&quot; button in the dataset viewer.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {currentStep !== 2.5 && (
          <div className="flex justify-between items-center p-6 border-t bg-gray-50">
          <div>
            {currentStep > 1 && currentStep < 3 && currentStep !== 2.5 && (
              <button
                onClick={() => setCurrentStep(currentStep - 1)}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                ← Back
              </button>
            )}
          </div>
          
          <div className="flex gap-3">
            {currentStep === 3 && !mergeResult ? (
              <div className="text-sm text-gray-500">Processing merge...</div>
            ) : currentStep >= 4 ? (
              <>
                <button
                  onClick={resetForm}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                >
                  Merge Another
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Close
                </button>
              </>
            ) : currentStep === 1 ? (
              <button
                onClick={() => setCurrentStep(2)}
                disabled={selectedDatasets.length < 2}
                className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                Next: Configure →
              </button>
            ) : (
              <>
                <button
                  onClick={onClose}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAnalyzeMerge}
                  disabled={!canProceed() || isAnalyzing}
                  className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isAnalyzing ? (
                    <>
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Analyzing...
                    </>
                  ) : isMerging ? (
                    <>
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Merging...
                    </>
                  ) : (
                    'Analyze & Start Merge'
                  )}
                </button>
              </>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
