'use client';

import React, { useState, useEffect } from 'react';
import DatasetViewer from './components/DatasetViewer';

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

export default function Home() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [deletingDatasetId, setDeletingDatasetId] = useState<number | null>(null);
  const [editingDatasetId, setEditingDatasetId] = useState<number | null>(null);
  const [editedDatasetName, setEditedDatasetName] = useState('');
  const [savingDatasetId, setSavingDatasetId] = useState<number | null>(null);

  const fetchDatasets = async () => {
    try {
      const response = await fetch('/api/datasets');
      if (response.ok) {
        const data = await response.json();
        setDatasets(data);
      }
    } catch (error) {
      console.error('Error fetching datasets:', error);
    }
  };

  useEffect(() => {
    fetchDatasets();
  }, []);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadStatus('');

    try {
      const text = await file.text();
      const json = JSON.parse(text);

      // Upload to backend API
      const response = await fetch('/api/upload-coco-json', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(json),
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const result = await response.json();
      console.log('API response:', result);
      setUploadStatus(`Successfully uploaded dataset with ${result.stats.images} images and ${result.stats.annotations} annotations!`);
      
      // Refresh datasets list
      await fetchDatasets();
      
      // Auto-select the newly created dataset
      setSelectedDatasetId(result.datasetId);

      // Reset the input
      event.target.value = '';

    } catch (error) {
      console.error('Error:', error);
      setUploadStatus('Error uploading JSON file');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDataset = async (datasetId: number, datasetName: string) => {
    if (!confirm(`Are you sure you want to delete the dataset "${datasetName}"? This will permanently delete all images and annotations.`)) {
      return;
    }

    setDeletingDatasetId(datasetId);
    try {
      const response = await fetch(`/api/datasets/${datasetId}`, {
        method: 'DELETE',
      });

      const result = await response.json();

      if (response.ok) {
        // Refresh datasets list
        await fetchDatasets();
        
        // Clear selection if the deleted dataset was selected
        if (selectedDatasetId === datasetId) {
          setSelectedDatasetId(null);
        }
        
        setUploadStatus(`Dataset "${datasetName}" deleted successfully. ${result.filesDeleted} files removed from storage.`);
      } else {
        setUploadStatus(`Error deleting dataset: ${result.error}`);
      }
    } catch (error) {
      setUploadStatus(`Error deleting dataset: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setDeletingDatasetId(null);
    }
  };

  const handleEditDatasetName = (datasetId: number, currentName: string) => {
    setEditingDatasetId(datasetId);
    setEditedDatasetName(currentName);
  };

  const handleSaveDatasetName = async (datasetId: number) => {
    if (!editedDatasetName.trim()) return;
    
    setSavingDatasetId(datasetId);
    try {
      const response = await fetch(`/api/datasets/${datasetId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: editedDatasetName.trim() }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update dataset name');
      }

      // Refresh datasets list to get updated data
      await fetchDatasets();
      setEditingDatasetId(null);
      setEditedDatasetName('');
      
    } catch (error) {
      console.error('Error updating dataset name:', error);
      setUploadStatus(`Failed to update dataset name: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setSavingDatasetId(null);
    }
  };

  const handleCancelEditDatasetName = () => {
    setEditingDatasetId(null);
    setEditedDatasetName('');
  };

  const handleDatasetNameKeyDown = (e: React.KeyboardEvent, datasetId: number) => {
    if (e.key === 'Enter') {
      handleSaveDatasetName(datasetId);
    } else if (e.key === 'Escape') {
      handleCancelEditDatasetName();
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">COCO Dataset Tag Editor</h1>
          <p className="text-gray-600 mt-2">Upload COCO annotations and images to view and edit tags</p>
        </div>

        {/* Upload Section */}
        <div className="bg-white rounded-lg shadow mb-8 p-6">
          <h2 className="text-xl font-semibold mb-4">Upload COCO Dataset</h2>
          <div className="flex flex-col space-y-4">
            <div>
              <label htmlFor="coco-upload" className="block text-sm font-medium text-gray-700 mb-2">
                Upload COCO JSON file
              </label>
              <input
                id="coco-upload"
                type="file"
                accept=".json"
                onChange={handleFileChange}
                disabled={uploading}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50"
              />
            </div>
            
            {uploading && (
              <div className="text-blue-600">Uploading and processing...</div>
            )}
            
            {uploadStatus && (
              <div className={`p-3 rounded-md text-sm ${
                uploadStatus.includes('Error') 
                  ? 'bg-red-100 text-red-700' 
                  : 'bg-green-100 text-green-700'
              }`}>
                {uploadStatus}
              </div>
            )}
          </div>
        </div>

        {/* Datasets List */}
        {datasets.length > 0 && (
          <div className="bg-white rounded-lg shadow mb-8 p-6">
            <h2 className="text-xl font-semibold mb-4">Your Datasets</h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {datasets.map((dataset) => (
                <div
                  key={dataset.id}
                  className={`border rounded-lg p-4 relative transition-colors ${
                    selectedDatasetId === dataset.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div 
                    className="cursor-pointer"
                    onClick={() => setSelectedDatasetId(dataset.id)}
                  >
                    {/* Dataset Name with Edit Functionality */}
                    {editingDatasetId === dataset.id ? (
                      <div className="flex items-center gap-2 mb-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          value={editedDatasetName}
                          onChange={(e) => setEditedDatasetName(e.target.value)}
                          onKeyDown={(e) => handleDatasetNameKeyDown(e, dataset.id)}
                          className="font-medium text-gray-900 bg-white border border-gray-300 rounded px-2 py-1 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="Enter dataset name"
                          autoFocus
                        />
                        <button
                          onClick={() => handleSaveDatasetName(dataset.id)}
                          disabled={savingDatasetId === dataset.id || !editedDatasetName.trim()}
                          className="p-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                          title="Save name"
                        >
                          {savingDatasetId === dataset.id ? (
                            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                          ) : (
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                        <button
                          onClick={handleCancelEditDatasetName}
                          disabled={savingDatasetId === dataset.id}
                          className="p-1 bg-gray-500 text-white rounded hover:bg-gray-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
                          title="Cancel"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-medium text-gray-900 flex-1">{dataset.name || 'Unnamed Dataset'}</h3>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditDatasetName(dataset.id, dataset.name || '');
                          }}
                          className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors opacity-0 group-hover:opacity-100"
                          title="Edit dataset name"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                      </div>
                    )}
                    
                    {dataset.description && (
                      <p className="text-sm text-gray-600 mt-1">{dataset.description}</p>
                    )}
                    <div className="flex gap-4 mt-2 text-xs text-gray-500">
                      <span>{dataset._count.images} images</span>
                      <span>{dataset._count.categories} categories</span>
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {new Date(dataset.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  
                  {/* Action buttons */}
                  <div className="absolute top-2 right-2 flex gap-1">
                    {/* Edit button - visible on hover */}
                    {editingDatasetId !== dataset.id && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditDatasetName(dataset.id, dataset.name || '');
                        }}
                        className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        title="Edit dataset name"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                    )}
                    
                    {/* Delete button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteDataset(dataset.id, dataset.name);
                      }}
                      disabled={deletingDatasetId === dataset.id}
                      className="p-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                      title="Delete dataset"
                    >
                      {deletingDatasetId === dataset.id ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-600"></div>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}        {/* Dataset Viewer */}
        {selectedDatasetId && (
          <DatasetViewer datasetId={selectedDatasetId} />
        )}

        {datasets.length === 0 && !uploading && (
          <div className="text-center py-12">
            <div className="text-gray-500">
              <p>No datasets found. Upload a COCO JSON file to get started.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
