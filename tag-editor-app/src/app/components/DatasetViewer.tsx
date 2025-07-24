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
  thumbnailPath?: string | null;
  annotations: Annotation[];
}

interface Dataset {
  id: number;
  name: string;
  description?: string;
  images: Image[];
  categories: Category[];
  pagination?: {
    page: number;
    pageSize: number;
    totalPages: number;
    totalImages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
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
  const [isDownloadingImages, setIsDownloadingImages] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editedDescription, setEditedDescription] = useState('');
  const [isSavingDescription, setIsSavingDescription] = useState(false);
  const [isGeneratingThumbnails, setIsGeneratingThumbnails] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const [pendingNavigationIntent, setPendingNavigationIntent] = useState<'next' | 'previous' | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    const loadDataset = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/datasets?id=${datasetId}&page=${currentPage}&pageSize=${pageSize}`);
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
  }, [datasetId, currentPage, pageSize]);

  // Handle pending navigation intent after page loads
  useEffect(() => {
    if (dataset && !loading && pendingNavigationIntent) {
      if (pendingNavigationIntent === 'next') {
        setCurrentImageIndex(0); // First image of the new page
      } else if (pendingNavigationIntent === 'previous') {
        setCurrentImageIndex(Math.max(0, dataset.images.length - 1)); // Last image of the new page
      }
      setPendingNavigationIntent(null); // Clear the pending intent
    }
  }, [dataset, loading, pendingNavigationIntent]);

  const handleUploadComplete = () => {
    // Refresh dataset data after upload
    const refreshDataset = async () => {
      try {
        const response = await fetch(`/api/datasets?id=${datasetId}&page=${currentPage}&pageSize=${pageSize}`);
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

  const handleImageDeleted = () => {
    if (!dataset) return;
    
    // Remove the deleted image from the dataset
    const updatedImages = dataset.images.filter((_, index) => index !== currentImageIndex);
    
    const updatedDataset = {
      ...dataset,
      images: updatedImages
    };
    
    setDataset(updatedDataset);
    
    // Adjust current image index if necessary
    if (updatedImages.length === 0) {
      setCurrentImageIndex(0);
    } else if (currentImageIndex >= updatedImages.length) {
      setCurrentImageIndex(updatedImages.length - 1);
    }
    // If currentImageIndex is within bounds, it stays the same and will show the next image
  };

  // Navigation functions for ImageViewer - Updated for pagination
  const handleNavigatePrevious = () => {
    if (currentImageIndex > 0) {
      setCurrentImageIndex(currentImageIndex - 1);
    } else if (hasGalleryPrevious) {
      // Go to previous page and select the last image
      setPendingNavigationIntent('previous');
      setCurrentPage(currentPage - 1);
    }
  };

  const handleNavigateNext = () => {
    if (dataset && currentImageIndex < dataset.images.length - 1) {
      setCurrentImageIndex(currentImageIndex + 1);
    } else if (hasGalleryNext) {
      // Go to next page and select the first image
      setPendingNavigationIntent('next');
      setCurrentPage(currentPage + 1);
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

  const handleDownloadImages = async () => {
    if (!dataset) return;
    
    setIsDownloadingImages(true);
    try {
      const response = await fetch(`/api/datasets/${dataset.id}/download-images`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to download images');
      }
      
      // Get the filename from the Content-Disposition header
      const contentDisposition = response.headers.get('Content-Disposition');
      const filename = contentDisposition
        ? contentDisposition.split('filename=')[1]?.replace(/"/g, '')
        : `${dataset.name || 'dataset'}_images.zip`;

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
      console.error('Error downloading images:', error);
      alert(`Failed to download images: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsDownloadingImages(false);
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
        method: 'PATCH',
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

  const handleEditDescription = () => {
    if (!dataset) return;
    setEditedDescription(dataset.description || '');
    setIsEditingDescription(true);
  };

  const handleSaveDescription = async () => {
    if (!dataset) return;
    
    setIsSavingDescription(true);
    try {
      const response = await fetch(`/api/datasets/${dataset.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ description: editedDescription.trim() }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update dataset description');
      }

      // Update the local dataset state
      setDataset(prev => prev ? { 
        ...prev, 
        description: editedDescription.trim() || undefined 
      } : null);
      setIsEditingDescription(false);
      
    } catch (error) {
      console.error('Error updating dataset description:', error);
      alert(`Failed to update dataset description: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSavingDescription(false);
    }
  };

  const handleCancelEditDescription = () => {
    setIsEditingDescription(false);
    setEditedDescription('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveName();
    } else if (e.key === 'Escape') {
      handleCancelEditName();
    }
  };

  const handleDescriptionKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      handleSaveDescription();
    } else if (e.key === 'Escape') {
      handleCancelEditDescription();
    }
  };

  const handleGenerateThumbnails = async () => {
    if (!dataset) return;
    
    setIsGeneratingThumbnails(true);
    try {
      const response = await fetch('/api/generate-thumbnails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ datasetId: dataset.id }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate thumbnails');
      }

      const result = await response.json();
      alert(`Generated thumbnails for ${result.processed} images`);
      
      // Refresh dataset to get updated thumbnail paths
      const refreshResponse = await fetch(`/api/datasets?id=${dataset.id}&page=${currentPage}&pageSize=${pageSize}`);
      if (refreshResponse.ok) {
        const refreshedData = await refreshResponse.json();
        setDataset(refreshedData);
      }
      
    } catch (error) {
      console.error('Error generating thumbnails:', error);
      alert('Failed to generate thumbnails. Please try again.');
    } finally {
      setIsGeneratingThumbnails(false);
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
  
  // Gallery pagination (now server-side)
  const galleryImages = dataset.images; // Already paginated from server
  const hasGalleryPrevious = dataset.pagination?.hasPreviousPage ?? false;
  const hasGalleryNext = dataset.pagination?.hasNextPage ?? false;
  
  const handleGalleryPrevious = () => {
    if (hasGalleryPrevious) {
      setCurrentPage(currentPage - 1);
      setCurrentImageIndex(0); // Reset to first image of new page
    }
  };
  
  const handleGalleryNext = () => {
    if (hasGalleryNext) {
      setCurrentPage(currentPage + 1);
      setCurrentImageIndex(0); // Reset to first image of new page
    }
  };
  
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1); // Reset to first page
    setCurrentImageIndex(0); // Reset to first image
  };
  
  const handleGalleryImageClick = (index: number) => {
    setCurrentImageIndex(index); // Index is now relative to current page
  };

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
            {/* Dataset Description with Edit Functionality */}
            <div className="mt-2">
              {isEditingDescription ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    value={editedDescription}
                    onChange={(e) => setEditedDescription(e.target.value)}
                    onKeyDown={handleDescriptionKeyDown}
                    className="text-gray-600 bg-white border border-gray-300 rounded px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Enter dataset description (optional)"
                    rows={3}
                    autoFocus
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSaveDescription}
                      disabled={isSavingDescription}
                      className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-sm flex items-center gap-1"
                    >
                      {isSavingDescription ? (
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
                      onClick={handleCancelEditDescription}
                      disabled={isSavingDescription}
                      className="px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-sm flex items-center gap-1"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      Cancel
                    </button>
                    <span className="text-xs text-gray-500">Press Ctrl+Enter to save, Esc to cancel</span>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  {dataset.description ? (
                    <p className="text-gray-600 flex-1">{dataset.description}</p>
                  ) : (
                    <p className="text-gray-400 italic flex-1">No description</p>
                  )}
                  <button
                    onClick={handleEditDescription}
                    className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors flex-shrink-0"
                    title="Edit dataset description"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
            <div className="flex gap-4 mt-2 text-sm text-gray-500">
              <span>{dataset.images.length} images uploaded</span>
              <span>{dataset.categories.length} categories</span>
              <span>
                {dataset.images.reduce((sum, img) => sum + img.annotations.length, 0)} annotations
              </span>
              <span className={`${dataset.images.filter(img => img.thumbnailPath).length === dataset.images.length ? 'text-green-600' : 'text-orange-600'}`}>
                {dataset.images.filter(img => img.thumbnailPath).length} / {dataset.images.length} thumbnails
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
              onClick={handleGenerateThumbnails}
              disabled={isGeneratingThumbnails || dataset.images.length === 0}
              className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isGeneratingThumbnails ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Generating...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Generate Thumbnails
                </>
              )}
            </button>
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
              onClick={handleDownloadImages}
              disabled={isDownloadingImages || dataset.images.length === 0}
              className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isDownloadingImages ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Downloading...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download Images
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
          {hasImages ? (
            <>
              {/* Navigation */}
              <div className="flex items-center justify-between bg-white rounded-lg shadow p-4">
                <button
                  onClick={handleNavigatePrevious}
                  disabled={currentImageIndex === 0 && !hasGalleryPrevious}
                  className="px-4 py-2 bg-gray-600 text-white rounded disabled:bg-gray-300"
                >
                  Previous
                </button>
                
                <span className="text-gray-700">
                  Image {((currentPage - 1) * pageSize) + currentImageIndex + 1} of {dataset.pagination?.totalImages ?? dataset.images.length}
                </span>
                
                <button
                  onClick={handleNavigateNext}
                  disabled={currentImageIndex === dataset.images.length - 1 && !hasGalleryNext}
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
                hasPrevious={currentImageIndex > 0 || hasGalleryPrevious}
                hasNext={currentImageIndex < dataset.images.length - 1 || hasGalleryNext}
                onImageDeleted={handleImageDeleted}
                isModalOpen={isModalOpen}
                setIsModalOpen={setIsModalOpen}
              />
            </>
          ) : (
            <div className="bg-white rounded-lg shadow p-8 text-center">
              <div className="mb-4">
                <svg className="mx-auto h-16 w-16 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 002 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No images in dataset</h3>
              <p className="text-gray-500 mb-4">
                This dataset doesn&apos;t contain any images yet. Upload some images to get started.
              </p>
              <button
                onClick={() => setShowUpload(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
              >
                Upload Images
              </button>
            </div>
          )}

          {/* Image Gallery */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Image Gallery</h3>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <label htmlFor="page-size" className="text-sm text-gray-600">
                    Images per page:
                  </label>
                  <select
                    id="page-size"
                    value={pageSize}
                    onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                    className="px-3 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value={8}>8</option>
                    <option value={16}>16</option>
                    <option value={32}>32</option>
                    <option value={48}>48</option>
                    <option value={64}>64</option>
                  </select>
                </div>
                <div className="text-sm text-gray-500">
                  Showing {((currentPage - 1) * pageSize) + 1}-{Math.min(currentPage * pageSize, dataset.pagination?.totalImages ?? dataset.images.length)} of {dataset.pagination?.totalImages ?? dataset.images.length} images
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              {/* Previous Button */}
              <button
                onClick={handleGalleryPrevious}
                disabled={!hasGalleryPrevious}
                className="flex-shrink-0 p-2 bg-gray-600 text-white rounded-full hover:bg-gray-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                title="Previous images"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              
              {/* Gallery Grid */}
              <div className={`flex-1 grid gap-3 ${
                pageSize <= 8 ? 'grid-cols-8' :
                pageSize <= 16 ? 'grid-cols-8 lg:grid-cols-8 xl:grid-cols-8' :
                pageSize <= 32 ? 'grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-8' :
                'grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-8'
              }`}>
                {galleryImages.map((image, index) => {
                  return (
                    <div
                      key={image.id}
                      className={`relative aspect-square overflow-hidden rounded-lg cursor-pointer transition-all duration-200 hover:scale-105 hover:shadow-lg ${
                        index === currentImageIndex
                          ? 'ring-4 ring-blue-500 ring-opacity-75 shadow-lg'
                          : 'ring-2 ring-gray-200 hover:ring-gray-300'
                      }`}
                      onClick={() => handleGalleryImageClick(index)}
                    >
                      <img
                        src={
                          image.thumbnailPath 
                            ? `/api/images/${image.thumbnailPath}`
                            : image.filePath 
                              ? image.filePath.startsWith('/') 
                                ? image.filePath  // Legacy local path
                                : `/api/images/${image.filePath}`  // MinIO object name
                              : `/uploads/${dataset.id}/${image.fileName}`  // Fallback
                        }
                        alt={`${image.fileName} thumbnail`}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                      
                      {/* Image overlay with info */}
                      <div className="absolute inset-0 bg-black bg-opacity-0 hover:bg-opacity-50 transition-all duration-200 flex items-end">
                        <div className="w-full p-2 text-white text-xs bg-gradient-to-t from-black to-transparent opacity-0 hover:opacity-100 transition-opacity duration-200">
                          <div className="font-medium truncate">{image.fileName}</div>
                          <div className="text-gray-300">
                            {image.annotations.length} annotation{image.annotations.length !== 1 ? 's' : ''}
                          </div>
                        </div>
                      </div>
                      
                      {/* Current image indicator */}
                      {index === currentImageIndex && (
                        <div className="absolute top-2 right-2 bg-blue-500 text-white text-xs px-2 py-1 rounded-full font-medium">
                          Current
                        </div>
                      )}
                      
                      {/* Image number */}
                      <div className="absolute top-2 left-2 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded-full">
                        {((currentPage - 1) * pageSize) + index + 1}
                      </div>
                      
                      {/* Warning icon for images without thumbnails */}
                      {!image.thumbnailPath && (
                        <div className="absolute bottom-2 right-2 bg-yellow-500 text-white p-1 rounded-full" title="No thumbnail - using full image">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.232 16.5c-.77.833.192 2.5 1.732 2.5z" />
                          </svg>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              
              {/* Next Button */}
              <button
                onClick={handleGalleryNext}
                disabled={!hasGalleryNext}
                className="flex-shrink-0 p-2 bg-gray-600 text-white rounded-full hover:bg-gray-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                title="Next images"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            
            {/* Gallery navigation info */}
            <div className="mt-4 text-sm text-gray-500 text-center">
              Click on any image to view it in detail above
            </div>
          </div>
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
