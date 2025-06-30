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
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

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
    setUploadStatus(null);

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
                  className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                    selectedDatasetId === dataset.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                  onClick={() => setSelectedDatasetId(dataset.id)}
                >
                  <h3 className="font-medium text-gray-900">{dataset.name}</h3>
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
              ))}
            </div>
          </div>
        )}

        {/* Dataset Viewer */}
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
