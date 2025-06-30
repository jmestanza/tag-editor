'use client';

import React, { useState } from 'react';

interface ImageUploadProps {
  datasetId: number;
  onUploadComplete: () => void;
  currentUploadedCount?: number;
  expectedTotalCount?: number;
}

export default function ImageUpload({ 
  datasetId, 
  onUploadComplete, 
  currentUploadedCount = 0,
  expectedTotalCount = 0 
}: ImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    current: number;
    total: number;
    currentFile: string;
  } | null>(null);
  const [uploadStatus, setUploadStatus] = useState<{
    message: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    setUploadStatus(null);
    setUploadProgress({ current: 0, total: files.length, currentFile: '' });

    try {
      const fileArray = Array.from(files);
      let successCount = 0;
      const errors: string[] = [];

      // Upload files one by one to track progress
      for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i];
        setUploadProgress({ 
          current: i, 
          total: fileArray.length, 
          currentFile: file.name 
        });

        try {
          const formData = new FormData();
          formData.append('datasetId', datasetId.toString());
          formData.append('images', file);

          const response = await fetch('/api/upload-images', {
            method: 'POST',
            body: formData,
          });

          const result = await response.json();

          if (!response.ok) {
            errors.push(`${file.name}: ${result.error || 'Upload failed'}`);
          } else {
            successCount++;
          }
        } catch (error) {
          errors.push(`${file.name}: ${error instanceof Error ? error.message : 'Upload failed'}`);
        }
      }

      // Final progress update
      setUploadProgress({ 
        current: fileArray.length, 
        total: fileArray.length, 
        currentFile: 'Complete' 
      });

      if (successCount > 0) {
        setUploadStatus({
          message: `Successfully uploaded ${successCount} out of ${fileArray.length} images`,
          type: successCount === fileArray.length ? 'success' : 'info',
        });
      } else {
        setUploadStatus({
          message: 'All uploads failed',
          type: 'error',
        });
      }

      if (errors.length > 0) {
        console.warn('Some files failed to upload:', errors);
      }

      // Reset the input
      event.target.value = '';
      
      // Notify parent component if any files were successful
      if (successCount > 0) {
        onUploadComplete();
      }

    } catch (error) {
      console.error('Upload error:', error);
      setUploadStatus({
        message: error instanceof Error ? error.message : 'Upload failed',
        type: 'error',
      });
    } finally {
      setUploading(false);
      // Clear progress after a delay
      setTimeout(() => setUploadProgress(null), 2000);
    }
  };

  return (
    <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
      <div className="space-y-4">
        <div>
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
            stroke="currentColor"
            fill="none"
            viewBox="0 0 48 48"
          >
            <path
              d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900">Upload Images</h3>
          <p className="mt-1 text-sm text-gray-500">
            Upload images that correspond to your COCO annotations
          </p>
          {expectedTotalCount > 0 && (
            <p className="mt-1 text-xs text-blue-600">
              Dataset Progress: {currentUploadedCount} / {expectedTotalCount} images uploaded
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="image-upload"
            className={`inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white ${
              uploading
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 cursor-pointer'
            }`}
          >
            {uploading ? 'Uploading...' : 'Select Images'}
          </label>
          <input
            id="image-upload"
            type="file"
            multiple
            accept="image/*"
            onChange={handleImageUpload}
            disabled={uploading}
            className="hidden"
          />
        </div>

        {/* Progress Bar */}
        {uploadProgress && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-gray-600">
              <span>Uploading: {uploadProgress.currentFile}</span>
              <span>{uploadProgress.current} / {uploadProgress.total}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ 
                  width: `${(uploadProgress.current / uploadProgress.total) * 100}%` 
                }}
              ></div>
            </div>
          </div>
        )}

        {uploadStatus && (
          <div
            className={`p-3 rounded-md text-sm ${
              uploadStatus.type === 'success'
                ? 'bg-green-100 text-green-700'
                : uploadStatus.type === 'error'
                ? 'bg-red-100 text-red-700'
                : 'bg-blue-100 text-blue-700'
            }`}
          >
            {uploadStatus.message}
          </div>
        )}
      </div>
    </div>
  );
}
