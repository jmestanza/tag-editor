'use client';

import React, { useState, useEffect } from 'react';
import ImageViewer from './ImageViewer';
import ImageUpload from './ImageUpload';

interface Category {
  id: number;
  name: string;
  supercategory?: string;
}

interface Annotation {
  id: number;
  bbox: number[];
  category: Category;
}

interface Image {
  id: number;
  fileName: string;
  width: number;
  height: number;
  filePath?: string | null;
  annotations: Annotation[];
}

interface Dataset {
  id: number;
  name: string;
  description?: string;
  images: Image[];
  categories: Category[];
  expectedImageCount?: number; // Total expected images for this dataset
  uploadedImageCount?: number; // Images that have been uploaded
}

interface DatasetViewerProps {
  datasetId: number;
}

export default function DatasetViewer({ datasetId }: DatasetViewerProps) {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [showUpload, setShowUpload] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);

  useEffect(() => {
    const loadDataset = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/datasets?id=${datasetId}`);
        if (!response.ok) {
          throw new Error('Failed to fetch dataset');
        }
        const data = await response.json();
        setDataset(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };
    
    loadDataset();
  }, [datasetId]);

  const handleUploadComplete = () => {
    // Refresh dataset data after upload
    const refreshDataset = async () => {
      try {
        const response = await fetch(`/api/datasets?id=${datasetId}`);
        if (response.ok) {
          const data = await response.json();
          setDataset(data);
        }
      } catch (err) {
        console.error('Error refreshing dataset:', err);
      }
    };
    
    refreshDataset();
    setShowUpload(false);
  };

  const handleAnnotationsUpdated = (updatedAnnotations: Annotation[]) => {
    if (!dataset) return;
    
    // Update the dataset with the new annotations for the current image
    const updatedDataset = {
      ...dataset,
      images: dataset.images.map((image, index) => 
        index === currentImageIndex 
          ? { ...image, annotations: updatedAnnotations }
          : image
      )
    };
    
    setDataset(updatedDataset);
  };

  // Navigation functions for ImageViewer
  const handleNavigatePrevious = () => {
    if (currentImageIndex > 0) {
      setCurrentImageIndex(currentImageIndex - 1);
    }
  };

  const handleNavigateNext = () => {
    if (dataset && currentImageIndex < dataset.images.length - 1) {
      setCurrentImageIndex(currentImageIndex + 1);
    }
  };  const handleExportAnnotations = async () => {
    if (!dataset) return;
    
    setIsExporting(true);
    try {
      const response = await fetch(`/api/datasets/${dataset.id}/export`);
      
      if (!response.ok) {
        throw new Error('Failed to export annotations');
      }
      
      // Get the filename from the Content-Disposition header
      const contentDisposition = response.headers.get('Content-Disposition');
      const filename = contentDisposition
        ? contentDisposition.split('filename=')[1]?.replace(/"/g, '')
        : `${dataset.name || 'dataset'}_annotations.json`;

      // Create a blob and download the file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
    } catch (error) {
      console.error('Error exporting annotations:', error);
      alert('Failed to export annotations. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleEditName = () => {
    if (!dataset) return;
    setEditedName(dataset.name || '');
    setIsEditingName(true);
  };

  const handleSaveName = async () => {
    if (!dataset || !editedName.trim()) return;
    
    setIsSavingName(true);
    try {
      const response = await fetch(`/api/datasets/${dataset.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: editedName.trim() }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update dataset name');
      }

      // const result = await response.json();
      
      // Update the local dataset state
      setDataset(prev => prev ? { ...prev, name: editedName.trim() } : null);
      setIsEditingName(false);
      
    } catch (error) {
      console.error('Error updating dataset name:', error);
      alert(`Failed to update dataset name: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSavingName(false);
    }
  };

  const handleCancelEditName = () => {
    setIsEditingName(false);
    setEditedName('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveName();
    } else if (e.key === 'Escape') {
      handleCancelEditName();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-gray-600">Loading dataset...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
        Error: {error}
      </div>
    );
  }

  if (!dataset) {
    return (
      <div className="text-center text-gray-600">Dataset not found</div>
    );
  }

  const currentImage = dataset.images[currentImageIndex];
  const hasImages = dataset.images.length > 0;
  const uploadedCount = dataset.images.length;
  const expectedCount = dataset.expectedImageCount || 0;
  const remainingCount = expectedCount > uploadedCount ? expectedCount - uploadedCount : 0;
  const uploadProgress = expectedCount > 0 ? (uploadedCount / expectedCount) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Dataset Header */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex justify-between items-start">
          <div className="flex-1">
            {/* Dataset Name with Edit Functionality */}
            <div className="flex items-center gap-3 mb-2">
              {isEditingName ? (
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="text"
                    value={editedName}
                    onChange={(e) => setEditedName(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="text-2xl font-bold text-gray-900 bg-white border border-gray-300 rounded px-2 py-1 flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Enter dataset name"
                    autoFocus
                  />
                  <button
                    onClick={handleSaveName}
                    disabled={isSavingName || !editedName.trim()}
                    className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-sm flex items-center gap-1"
                  >
                    {isSavingName ? (
                      <>
                        <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Saving...
                      </>
                    ) : (
                      <>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Save
                      </>
                    )}
                  </button>
                  <button
                    onClick={handleCancelEditName}
                    disabled={isSavingName}
                    className="px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-sm flex items-center gap-1"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <h2 className="text-2xl font-bold text-gray-900">{dataset.name || 'Unnamed Dataset'}</h2>
                  <button
                    onClick={handleEditName}
                    className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                    title="Edit dataset name"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                </>
              )}
            </div>
            {dataset.description && (
              <p className="text-gray-600 mt-1">{dataset.description}</p>
            )}
            <div className="flex gap-4 mt-2 text-sm text-gray-500">
              <span>{dataset.images.length} images uploaded</span>
              <span>{dataset.categories.length} categories</span>
              <span>
                {dataset.images.reduce((sum, img) => sum + img.annotations.length, 0)} annotations
              </span>
              {remainingCount > 0 && (
                <span className="text-orange-600 font-medium">
                  {remainingCount} images remaining
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleExportAnnotations}
              disabled={isExporting || dataset.images.length === 0}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isExporting ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Exporting...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Export Annotations
                </>
              )}
            </button>
            <button
              onClick={() => setShowUpload(!showUpload)}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              {showUpload ? 'Hide Upload' : 'Upload Images'}
            </button>
          </div>
        </div>
      </div>

      {/* Dataset Upload Progress */}
      {expectedCount > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-3">Upload Progress</h3>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Images uploaded</span>
              <span className="font-medium">
                {uploadedCount} / {expectedCount} ({uploadProgress.toFixed(1)}%)
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div 
                className={`h-3 rounded-full transition-all duration-500 ${
                  uploadProgress === 100 ? 'bg-green-500' : 'bg-blue-500'
                }`}
                style={{ width: `${Math.min(uploadProgress, 100)}%` }}
              ></div>
            </div>
            {remainingCount > 0 ? (
              <p className="text-sm text-orange-600">
                {remainingCount} images still need to be uploaded
              </p>
            ) : uploadedCount >= expectedCount ? (
              <p className="text-sm text-green-600 font-medium">
                ✅ All images uploaded!
              </p>
            ) : null}
          </div>
        </div>
      )}

      {/* Image Upload Section */}
      {showUpload && (
        <ImageUpload 
          datasetId={dataset.id} 
          onUploadComplete={handleUploadComplete}
          currentUploadedCount={uploadedCount}
          expectedTotalCount={expectedCount}
        />
      )}

      {/* Categories Overview */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-3">Categories</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {dataset.categories.map((category) => (
            <div key={category.id} className="bg-gray-700 text-white rounded px-3 py-2">
              <div className="font-medium text-sm text-black">{category.name}</div>
              {category.supercategory && (
                <div className="text-xs text-gray-300">{category.supercategory}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Image Viewer */}
      {hasImages ? (
        <div className="space-y-4">
          {/* Navigation */}
          <div className="flex items-center justify-between bg-white rounded-lg shadow p-4">
            <button
              onClick={() => setCurrentImageIndex(Math.max(0, currentImageIndex - 1))}
              disabled={currentImageIndex === 0}
              className="px-4 py-2 bg-gray-600 text-white rounded disabled:bg-gray-300"
            >
              Previous
            </button>
            
            <span className="text-gray-700">
              Image {currentImageIndex + 1} of {dataset.images.length}
            </span>
            
            <button
              onClick={() => setCurrentImageIndex(Math.min(dataset.images.length - 1, currentImageIndex + 1))}
              disabled={currentImageIndex === dataset.images.length - 1}
              className="px-4 py-2 bg-gray-600 text-white rounded disabled:bg-gray-300"
            >
              Next
            </button>
          </div>

          {/* Current Image */}
          <ImageViewer
            imageSrc={
              currentImage.filePath 
                ? currentImage.filePath.startsWith('/') 
                  ? currentImage.filePath  // Legacy local path
                  : `/api/images/${currentImage.filePath}`  // MinIO object name
                : `/uploads/${dataset.id}/${currentImage.fileName}`  // Fallback
            }
            imageWidth={currentImage.width}
            imageHeight={currentImage.height}
            annotations={currentImage.annotations}
            fileName={currentImage.fileName}
            imageId={currentImage.id}
            datasetId={dataset.id}
            onAnnotationsUpdated={handleAnnotationsUpdated}
            onNavigatePrevious={handleNavigatePrevious}
            onNavigateNext={handleNavigateNext}
            hasPrevious={currentImageIndex > 0}
            hasNext={currentImageIndex < dataset.images.length - 1}
          />
        </div>
      ) : (
        <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded">
          <p>
            No images have been uploaded yet. 
            {expectedCount > 0 && (
              <span> This dataset expects {expectedCount} images total.</span>
            )}
            {' '}Upload some images to view them with annotations.
          </p>
        </div>
      )}
    </div>
  );
}
