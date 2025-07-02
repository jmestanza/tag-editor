'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';

interface Category {
  id: number;
  name: string;
  supercategory?: string;
}

interface Annotation {
  id: number;
  bbox: number[]; // [x, y, width, height]
  category: Category;
}

interface ImageViewerProps {
  imageSrc: string;
  imageWidth: number;
  imageHeight: number;
  annotations: Annotation[];
  fileName: string;
  imageId?: number; // Add imageId for saving
  datasetId?: number; // Add datasetId for fetching categories
  onAnnotationsUpdated?: (annotations: Annotation[]) => void; // Callback for when annotations are saved
  onNavigatePrevious?: () => void; // Navigation callback for previous image
  onNavigateNext?: () => void; // Navigation callback for next image
  hasPrevious?: boolean; // Whether there's a previous image
  hasNext?: boolean; // Whether there's a next image
}

const COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'
];

export default function ImageViewer({ 
  imageSrc, 
  imageWidth, 
  imageHeight, 
  annotations, 
  fileName,
  imageId,
  datasetId,
  onAnnotationsUpdated,
  onNavigatePrevious,
  onNavigateNext,
  hasPrevious = false,
  hasNext = false
}: ImageViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modalCanvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const modalImageRef = useRef<HTMLImageElement>(null);
  
  const [displayScale, setDisplayScale] = useState(1);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [imageLoaded, setImageLoaded] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAnnotations, setEditingAnnotations] = useState<Annotation[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<number | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [currentDrawPos, setCurrentDrawPos] = useState({ x: 0, y: 0 });
  const [modalCanvasSize, setModalCanvasSize] = useState({ width: 0, height: 0 });
  const [isResizing, setIsResizing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [resizeHandle, setResizeHandle] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isSaving, setIsSaving] = useState(false);
  const [availableCategories, setAvailableCategories] = useState<Category[]>([]);
  const [showCategoryDialog, setShowCategoryDialog] = useState(false);
  const [pendingAnnotation, setPendingAnnotation] = useState<Omit<Annotation, 'category'> | null>(null);
  
  // Enhanced zoom and pan state
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const modalContainerRef = useRef<HTMLDivElement>(null);

  // Reset image loaded state when imageSrc changes
  useEffect(() => {
    setImageLoaded(false);
    // Also reset selected annotation when image changes
    setSelectedAnnotationId(null);
  }, [imageSrc]);

  // Initialize editing annotations when modal opens OR when annotations change
  useEffect(() => {
    if (isModalOpen) {
      setEditingAnnotations([...annotations]);
      // Reset selected annotation when annotations change (new image)
      setSelectedAnnotationId(null);
    }
  }, [isModalOpen, annotations]);

  // Reset modal state when imageSrc changes while modal is open
  useEffect(() => {
    if (isModalOpen) {
      // Reset all interactive states when switching images
      setSelectedAnnotationId(null);
      setIsDrawing(false);
      setIsResizing(false);
      setIsDragging(false);
      setIsPanning(false);
      setShowCategoryDialog(false);
      setPendingAnnotation(null);
      
      // Reset editing annotations to match new image
      setEditingAnnotations([...annotations]);
    }
  }, [imageSrc, isModalOpen, annotations]);

  // Fetch available categories for the dataset
  useEffect(() => {
    const fetchCategories = async () => {
      if (datasetId) {
        try {
          const response = await fetch(`/api/categories?datasetId=${datasetId}`);
          if (response.ok) {
            const data = await response.json();
            setAvailableCategories(data.categories || []);
          }
        } catch (error) {
          console.error('Error fetching categories:', error);
        }
      }
    };

    fetchCategories();
  }, [datasetId]);

  // Enhanced zoom control functions with better precision
  const zoomIn = () => {
    const newZoom = Math.min(zoomLevel * 1.2, 10); // Increased max zoom and smaller step
    setZoomLevel(newZoom);
    updateModalCanvasSize(newZoom);
  };

  const zoomOut = () => {
    const newZoom = Math.max(zoomLevel / 1.2, 0.1); // Smaller step for more control
    setZoomLevel(newZoom);
    updateModalCanvasSize(newZoom);
  };

  const zoomToFit = () => {
    const modalContainer = modalContainerRef.current;
    if (!modalContainer) return;
    
    const containerRect = modalContainer.getBoundingClientRect();
    const availableWidth = containerRect.width - 20; // Account for padding
    const availableHeight = containerRect.height - 20; // Account for padding only
    
    // Calculate scale to fit image in available space
    const widthScale = availableWidth / imageWidth;
    const heightScale = availableHeight / imageHeight;
    const fitScale = Math.min(widthScale, heightScale, 1);
    
    setZoomLevel(fitScale);
    updateModalCanvasSize(fitScale);
    
    // Center the image
    const scaledWidth = imageWidth * fitScale;
    const scaledHeight = imageHeight * fitScale;
    const centerX = Math.max(0, (availableWidth - scaledWidth) / 2);
    const centerY = Math.max(0, (availableHeight - scaledHeight) / 2);
    setPanOffset({ x: centerX, y: centerY });
  };

  const zoomToActualSize = () => {
    setZoomLevel(1);
    updateModalCanvasSize(1);
    
    // Center the image at actual size
    const modalContainer = modalContainerRef.current;
    if (modalContainer) {
      const containerRect = modalContainer.getBoundingClientRect();
      const availableWidth = containerRect.width - 40;
      const availableHeight = containerRect.height - 40;
      
      const centerX = (availableWidth - imageWidth) / 2;
      const centerY = (availableHeight - imageHeight) / 2;
      setPanOffset({ x: centerX, y: centerY });
    } else {
      setPanOffset({ x: 0, y: 0 });
    }
  };

  // Add zoom to selection functionality
  const zoomToSelection = () => {
    if (!selectedAnnotationId) return;
    
    const selectedAnnotation = editingAnnotations.find(ann => ann.id === selectedAnnotationId);
    if (!selectedAnnotation) return;
    
    const [x, y, width, height] = selectedAnnotation.bbox;
    const padding = Math.min(width, height) * 0.2; // 20% padding around the selection
    
    const containerWidth = window.innerWidth - 600; // Account for sidebar
    const containerHeight = window.innerHeight - 200;
    
    const scaleX = containerWidth / (width + padding);
    const scaleY = containerHeight / (height + padding);
    const targetZoom = Math.min(scaleX, scaleY, 10);
    
    setZoomLevel(targetZoom);
    updateModalCanvasSize(targetZoom);
    
    // Center the selection in the view
    const centerX = (x + width / 2) * targetZoom;
    const centerY = (y + height / 2) * targetZoom;
    const viewCenterX = containerWidth / 2;
    const viewCenterY = containerHeight / 2;
    
    setPanOffset({
      x: viewCenterX - centerX,
      y: viewCenterY - centerY
    });
  };

  const updateModalCanvasSize = (zoom: number) => {
    // Ensure canvas dimensions are exactly what we need with proper rounding
    // Use Math.ceil to ensure no pixels are lost due to rounding
    const canvasWidth = Math.ceil(imageWidth * zoom);
    const canvasHeight = Math.ceil(imageHeight * zoom);
    
    setModalCanvasSize({ width: canvasWidth, height: canvasHeight });
  };

  // Handle mouse wheel zoom with improved precision
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    
    const canvas = modalCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Use smaller zoom steps for more precise control
    const zoomFactor = e.deltaY > 0 ? 0.95 : 1.05;
    const newZoom = Math.min(Math.max(zoomLevel * zoomFactor, 0.1), 10); // Increased max zoom to 10x

    // Calculate new pan offset to zoom towards mouse position
    const zoomRatio = newZoom / zoomLevel;
    const newPanX = mouseX - (mouseX - panOffset.x) * zoomRatio;
    const newPanY = mouseY - (mouseY - panOffset.y) * zoomRatio;

    setZoomLevel(newZoom);
    updateModalCanvasSize(newZoom);
    setPanOffset({ x: newPanX, y: newPanY });
  };

  // Handle keyboard shortcuts for zoom and pan
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isModalOpen) return;

    switch (e.key) {
      case '+':
      case '=':
        e.preventDefault();
        zoomIn();
        break;
      case '-':
        e.preventDefault();
        zoomOut();
        break;
      case '0':
        e.preventDefault();
        zoomToActualSize();
        break;
      case 'f':
      case 'F':
        e.preventDefault();
        zoomToFit();
        break;
      case 'Escape':
        e.preventDefault();
        // Cancel any ongoing drawing operation
        if (isDrawing) {
          setIsDrawing(false);
          // The canvas will be redrawn in the next render cycle
        }
        // Cancel category selection dialog
        if (showCategoryDialog) {
          setShowCategoryDialog(false);
          setPendingAnnotation(null);
        }
        break;
      case 'ArrowLeft':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          setPanOffset(prev => ({ ...prev, x: prev.x + 20 }));
        } else if (hasPrevious && onNavigatePrevious) {
          e.preventDefault();
          onNavigatePrevious();
        }
        break;
      case 'ArrowRight':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          setPanOffset(prev => ({ ...prev, x: prev.x - 20 }));
        } else if (hasNext && onNavigateNext) {
          e.preventDefault();
          onNavigateNext();
        }
        break;
      case 'ArrowUp':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          setPanOffset(prev => ({ ...prev, y: prev.y + 20 }));
        }
        break;
      case 'ArrowDown':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          setPanOffset(prev => ({ ...prev, y: prev.y - 20 }));
        }
        break;
    }
  }, [isModalOpen, zoomIn, zoomOut, zoomToActualSize, zoomToFit, hasPrevious, hasNext, onNavigatePrevious, onNavigateNext, isDrawing, showCategoryDialog]);

  // Add keyboard event listeners
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Create a color map for categories
  const categoryColors = React.useMemo(() => {
    const colorMap = new Map<number, string>();
    const uniqueCategories = [...new Set(annotations.map(ann => ann.category.id))];
    uniqueCategories.forEach((catId, index) => {
      colorMap.set(catId, COLORS[index % COLORS.length]);
    });
    return colorMap;
  }, [annotations]);

  useEffect(() => {
    const maxDisplayWidth = 800;
    const maxDisplayHeight = 600;
    
    const scaleX = maxDisplayWidth / imageWidth;
    const scaleY = maxDisplayHeight / imageHeight;
    const scale = Math.min(scaleX, scaleY, 1); // Don't scale up

    const displayWidth = imageWidth * scale;
    const displayHeight = imageHeight * scale;

    setDisplayScale(scale);
    setCanvasSize({ width: displayWidth, height: displayHeight });

    // Modal canvas sizing - utilize full modal height
    if (isModalOpen) {
      // Initialize modal canvas size to maximize use of available space
      setTimeout(() => {
        const modalContainer = modalContainerRef.current;
        if (modalContainer) {
          const containerRect = modalContainer.getBoundingClientRect();
          const availableWidth = containerRect.width - 20; // Account for padding
          const availableHeight = containerRect.height - 20; // Account for padding only
          
          // Calculate scale to fit image in available space
          const widthScale = availableWidth / imageWidth;
          const heightScale = availableHeight / imageHeight;
          
          // Use the smaller scale to ensure the image fits completely
          const fitScale = Math.min(widthScale, heightScale, 1); // Don't scale up beyond 100%

          // Set initial zoom and canvas size
          setZoomLevel(fitScale);
          updateModalCanvasSize(fitScale);
          
          // Center the image in the container
          const scaledWidth = imageWidth * fitScale;
          const scaledHeight = imageHeight * fitScale;
          
          const centerX = Math.max(0, (availableWidth - scaledWidth) / 2);
          const centerY = Math.max(0, (availableHeight - scaledHeight) / 2);
          setPanOffset({ x: centerX, y: centerY });
        } else {
          // Fallback - start at 100% zoom
          setZoomLevel(1);
          updateModalCanvasSize(1);
          setPanOffset({ x: 0, y: 0 });
        }
      }, 100); // Increased timeout to ensure container is properly sized
    }
  }, [imageWidth, imageHeight, isModalOpen, imageSrc]); // Added imageSrc as dependency

  useEffect(() => {
    const draw = () => {
      const canvas = canvasRef.current;
      const image = imageRef.current;
      
      if (!canvas || !image || !imageLoaded) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw image
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

      // Draw annotations
      annotations.forEach((annotation) => {
        const [x, y, width, height] = annotation.bbox;
        const color = categoryColors.get(annotation.category.id) || '#FF0000';

        // Scale coordinates to display size
        const scaledX = x * displayScale;
        const scaledY = y * displayScale;
        const scaledWidth = width * displayScale;
        const scaledHeight = height * displayScale;

        // Draw bounding box
        ctx.strokeStyle = color;
        ctx.lineWidth = 1; // Made much thinner for high-resolution images
        ctx.strokeRect(scaledX, scaledY, scaledWidth, scaledHeight);

        // Draw category label background
        const label = annotation.category.name;
        ctx.font = '12px Arial';
        const textMetrics = ctx.measureText(label);
        const textWidth = textMetrics.width;
        const textHeight = 12;

        ctx.fillStyle = color;
        ctx.fillRect(scaledX, scaledY - textHeight - 4, textWidth + 8, textHeight + 4);

        // Draw category label text
        ctx.fillStyle = 'white';
        ctx.fillText(label, scaledX + 4, scaledY - 4);
      });
    };

    if (imageLoaded) {
      draw();
    }
  }, [imageLoaded, annotations, displayScale, categoryColors]);

  // Modal canvas drawing
  const drawModalCanvas = useCallback(() => {
    const canvas = modalCanvasRef.current;
    const image = modalImageRef.current;
    
    // Early return if not ready to draw
    if (!canvas || !image || !imageLoaded || !isModalOpen) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas with exact dimensions
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw image directly without pan/zoom transforms on the context
    // The canvas itself is positioned, so we draw at 0,0
    const scaledWidth = imageWidth * zoomLevel;
    const scaledHeight = imageHeight * zoomLevel;
    ctx.drawImage(image, 0, 0, scaledWidth, scaledHeight);

    // Draw annotations directly on the scaled canvas
    editingAnnotations.forEach((annotation) => {
      const [x, y, width, height] = annotation.bbox;
      const color = categoryColors.get(annotation.category.id) || '#FF0000';

      // Scale coordinates to current zoom level
      const scaledX = x * zoomLevel;
      const scaledY = y * zoomLevel;
      const scaledWidth = width * zoomLevel;
      const scaledHeight = height * zoomLevel;

      // Highlight selected annotation
      if (selectedAnnotationId === annotation.id) {
        ctx.strokeStyle = '#FFD700';
        ctx.lineWidth = 2;
        ctx.strokeRect(scaledX - 2, scaledY - 2, scaledWidth + 4, scaledHeight + 4);
        
        // Draw resize handles for selected annotation
        const handleSize = Math.max(8, 12 / zoomLevel);
        ctx.fillStyle = '#FFD700';
        
        // Corner handles
        ctx.fillRect(scaledX - handleSize/2, scaledY - handleSize/2, handleSize, handleSize);
        ctx.fillRect(scaledX + scaledWidth - handleSize/2, scaledY - handleSize/2, handleSize, handleSize);
        ctx.fillRect(scaledX - handleSize/2, scaledY + scaledHeight - handleSize/2, handleSize, handleSize);
        ctx.fillRect(scaledX + scaledWidth - handleSize/2, scaledY + scaledHeight - handleSize/2, handleSize, handleSize);
        
        // Edge handles
        ctx.fillRect(scaledX + scaledWidth/2 - handleSize/2, scaledY - handleSize/2, handleSize, handleSize);
        ctx.fillRect(scaledX + scaledWidth/2 - handleSize/2, scaledY + scaledHeight - handleSize/2, handleSize, handleSize);
        ctx.fillRect(scaledX - handleSize/2, scaledY + scaledHeight/2 - handleSize/2, handleSize, handleSize);
        ctx.fillRect(scaledX + scaledWidth - handleSize/2, scaledY + scaledHeight/2 - handleSize/2, handleSize, handleSize);
      }

      // Draw bounding box
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, 2 / zoomLevel);
      ctx.strokeRect(scaledX, scaledY, scaledWidth, scaledHeight);

      // Draw category label background
      const label = annotation.category.name;
      const fontSize = Math.max(10, Math.min(14, 16 / zoomLevel));
      ctx.font = `${fontSize}px Arial`;
      const textMetrics = ctx.measureText(label);
      const textWidth = textMetrics.width;
      const textHeight = fontSize;

      ctx.fillStyle = color;
      ctx.fillRect(scaledX, scaledY - textHeight - 4, textWidth + 8, textHeight + 4);

      // Draw category label text
      ctx.fillStyle = 'white';
      ctx.fillText(label, scaledX + 4, scaledY - 4);
    });

    // Draw temporary drawing rectangle if currently drawing
    if (isDrawing) {
      let drawX = currentDrawPos.x;
      let drawY = currentDrawPos.y;
      
      // Add snapping when zoomed in
      if (zoomLevel > 2) {
        drawX = Math.round(drawX);
        drawY = Math.round(drawY);
      }

      // Calculate the rectangle bounds
      const rectX = Math.min(startPos.x, drawX);
      const rectY = Math.min(startPos.y, drawY);
      const rectWidth = Math.abs(drawX - startPos.x);
      const rectHeight = Math.abs(drawY - startPos.y);
      
      // Check if rectangle is outside image bounds
      const isOutOfBounds = rectX < 0 || rectY < 0 || 
                           rectX + rectWidth > imageWidth || 
                           rectY + rectHeight > imageHeight;

      // Draw temporary bounding box
      if (isOutOfBounds) {
        // Use saturated red for out-of-bounds rectangles
        ctx.strokeStyle = '#FF0000';
        ctx.globalAlpha = 0.8; // More saturated/opaque
      } else {
        // Use normal red for valid rectangles
        ctx.strokeStyle = '#FF0000';
        ctx.globalAlpha = 0.6; // Less saturated
      }
      
      ctx.lineWidth = Math.max(1, 2 / zoomLevel);
      ctx.setLineDash([Math.max(3, 5 / zoomLevel), Math.max(3, 5 / zoomLevel)]);
      ctx.strokeRect(
        rectX * zoomLevel,
        rectY * zoomLevel,
        rectWidth * zoomLevel,
        rectHeight * zoomLevel
      );
      ctx.setLineDash([]);
      ctx.globalAlpha = 1.0; // Reset alpha
    }
  }, [imageLoaded, editingAnnotations, selectedAnnotationId, zoomLevel, categoryColors, isDrawing, startPos, currentDrawPos, imageWidth, imageHeight]);

  // Helper function to get resize handle at position
  const getResizeHandle = (mouseX: number, mouseY: number, annotation: Annotation): string | null => {
    const [x, y, width, height] = annotation.bbox;
    
    // Convert mouse coordinates to image space
    // Since the canvas is already positioned with panOffset, mouse coordinates
    // from getBoundingClientRect are already relative to the canvas
    const imageX = mouseX / zoomLevel;
    const imageY = mouseY / zoomLevel;
    
    // Use a larger tolerance to make handles easier to grab
    const tolerance = Math.max(8, 12 / zoomLevel);
    
    // Check corner handles first (they have priority over edge handles)
    if (Math.abs(imageX - x) <= tolerance && Math.abs(imageY - y) <= tolerance) return 'nw-resize';
    if (Math.abs(imageX - (x + width)) <= tolerance && Math.abs(imageY - y) <= tolerance) return 'ne-resize';
    if (Math.abs(imageX - x) <= tolerance && Math.abs(imageY - (y + height)) <= tolerance) return 'sw-resize';
    if (Math.abs(imageX - (x + width)) <= tolerance && Math.abs(imageY - (y + height)) <= tolerance) return 'se-resize';
    
    // Check edge handles (only if not on corners)
    if (Math.abs(imageX - (x + width/2)) <= tolerance && Math.abs(imageY - y) <= tolerance) return 'n-resize';
    if (Math.abs(imageX - (x + width/2)) <= tolerance && Math.abs(imageY - (y + height)) <= tolerance) return 's-resize';
    if (Math.abs(imageX - x) <= tolerance && Math.abs(imageY - (y + height/2)) <= tolerance) return 'w-resize';
    if (Math.abs(imageX - (x + width)) <= tolerance && Math.abs(imageY - (y + height/2)) <= tolerance) return 'e-resize';
    
    return null;
  };

  // Helper function to update annotation bbox based on resize handle
  const updateAnnotationBbox = (annotation: Annotation, mouseX: number, mouseY: number, handle: string) => {
    const [origX, origY, origWidth, origHeight] = annotation.bbox;
    
    // Convert mouse coordinates to image space
    // Since the canvas is already positioned with panOffset, mouse coordinates
    // from getBoundingClientRect are already relative to the canvas
    const newMouseX = mouseX / zoomLevel;
    const newMouseY = mouseY / zoomLevel;
    
    let newX = origX;
    let newY = origY;
    let newWidth = origWidth;
    let newHeight = origHeight;
    
    switch (handle) {
      case 'nw-resize':
        newX = newMouseX;
        newY = newMouseY;
        newWidth = origX + origWidth - newMouseX;
        newHeight = origY + origHeight - newMouseY;
        break;
      case 'ne-resize':
        newY = newMouseY;
        newWidth = newMouseX - origX;
        newHeight = origY + origHeight - newMouseY;
        break;
      case 'sw-resize':
        newX = newMouseX;
        newWidth = origX + origWidth - newMouseX;
        newHeight = newMouseY - origY;
        break;
      case 'se-resize':
        newWidth = newMouseX - origX;
        newHeight = newMouseY - origY;
        break;
      case 'n-resize':
        newY = newMouseY;
        newHeight = origY + origHeight - newMouseY;
        break;
      case 's-resize':
        newHeight = newMouseY - origY;
        break;
      case 'w-resize':
        newX = newMouseX;
        newWidth = origX + origWidth - newMouseX;
        break;
      case 'e-resize':
        newWidth = newMouseX - origX;
        break;
    }
    
    // Ensure minimum size (1 pixel in image space)
    if (newWidth < 1) {
      if (handle.includes('w')) newX = origX + origWidth - 1;
      newWidth = 1;
    }
    if (newHeight < 1) {
      if (handle.includes('n')) newY = origY + origHeight - 1;
      newHeight = 1;
    }
    
    // Ensure bounds stay within image
    newX = Math.max(0, Math.min(newX, imageWidth - newWidth));
    newY = Math.max(0, Math.min(newY, imageHeight - newHeight));
    newWidth = Math.min(newWidth, imageWidth - newX);
    newHeight = Math.min(newHeight, imageHeight - newY);
    
    return [newX, newY, newWidth, newHeight];
  };

  // Mouse event handlers for modal canvas with improved panning
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = modalCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Convert to image coordinates
    // Since the canvas is already positioned with panOffset, mouse coordinates
    // from getBoundingClientRect are already relative to the canvas
    const x = mouseX / zoomLevel;
    const y = mouseY / zoomLevel;

    // Handle space bar + left click or middle mouse button for panning
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      setIsPanning(true);
      setPanStart({ x: mouseX, y: mouseY });
      canvas.style.cursor = 'grabbing';
      return;
    }

    // Check if clicking on existing annotation
    const clickedAnnotation = editingAnnotations.find(ann => {
      const [bx, by, bw, bh] = ann.bbox;
      return x >= bx && x <= bx + bw && y >= by && y <= by + bh;
    });

    if (clickedAnnotation) {
      // First, check if we're clicking on a resize handle
      const handle = getResizeHandle(mouseX, mouseY, clickedAnnotation);
      
      // Select the annotation
      setSelectedAnnotationId(clickedAnnotation.id);
      
      if (handle) {
        // Start resizing
        setIsResizing(true);
        setResizeHandle(handle);
        if (canvas) {
          canvas.style.cursor = handle;
        }
      } else {
        // Start dragging the entire box
        setIsDragging(true);
        setDragOffset({
          x: x - clickedAnnotation.bbox[0],
          y: y - clickedAnnotation.bbox[1]
        });
        if (canvas) {
          canvas.style.cursor = 'move';
        }
      }
    } else {
      setSelectedAnnotationId(null);
      
      // Only start drawing if not panning and coordinates are within image bounds
      if (!e.shiftKey && x >= 0 && y >= 0 && x <= imageWidth && y <= imageHeight) {
        setIsDrawing(true);
        setStartPos({ x, y });
        setCurrentDrawPos({ x, y }); // Initialize current position
        if (canvas) {
          canvas.style.cursor = 'crosshair';
        }
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = modalCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Handle panning
    if (isPanning) {
      const newPanX = panOffset.x + (mouseX - panStart.x);
      const newPanY = panOffset.y + (mouseY - panStart.y);
      setPanOffset({ x: newPanX, y: newPanY });
      setPanStart({ x: mouseX, y: mouseY });
      return;
    }

    // Convert to image coordinates
    // Since the canvas is already positioned with panOffset, mouse coordinates
    // from getBoundingClientRect are already relative to the canvas
    const x = mouseX / zoomLevel;
    const y = mouseY / zoomLevel;

    // Handle resizing with improved precision
    if (isResizing && selectedAnnotationId && resizeHandle) {
      const selectedAnnotation = editingAnnotations.find(ann => ann.id === selectedAnnotationId);
      if (selectedAnnotation) {
        const newBbox = updateAnnotationBbox(selectedAnnotation, mouseX, mouseY, resizeHandle);
        setEditingAnnotations(prev =>
          prev.map(ann =>
            ann.id === selectedAnnotationId
              ? { ...ann, bbox: newBbox }
              : ann
          )
        );
      }
      return;
    }

    // Handle dragging with snapping for precision
    if (isDragging && selectedAnnotationId) {
      const selectedAnnotation = editingAnnotations.find(ann => ann.id === selectedAnnotationId);
      if (selectedAnnotation) {
        let newX = x - dragOffset.x;
        let newY = y - dragOffset.y;
        
        // Add snapping to pixel boundaries when zoomed in
        if (zoomLevel > 2) {
          newX = Math.round(newX);
          newY = Math.round(newY);
        }
        
        // Ensure bounds
        newX = Math.max(0, Math.min(newX, imageWidth - selectedAnnotation.bbox[2]));
        newY = Math.max(0, Math.min(newY, imageHeight - selectedAnnotation.bbox[3]));
        
        setEditingAnnotations(prev =>
          prev.map(ann =>
            ann.id === selectedAnnotationId
              ? { ...ann, bbox: [newX, newY, ann.bbox[2], ann.bbox[3]] }
              : ann
          )
        );
      }
      return;
    }

    // Handle drawing new box with precision snapping
    if (isDrawing) {
      // Store the current drawing position for use in other functions
      setCurrentDrawPos({ x, y });
    }

    // Update cursor based on hover state with better feedback
    if (e.shiftKey) {
      canvas.style.cursor = 'grab';
    } else {
      // Check all annotations for handle detection or hover
      let cursorSet = false;
      
      // First check if we're over a resize handle on any annotation
      for (const annotation of editingAnnotations) {
        const handle = getResizeHandle(mouseX, mouseY, annotation);
        if (handle) {
          canvas.style.cursor = handle;
          cursorSet = true;
          break;
        }
      }
      
      // If not over a handle, check if we're over an annotation body
      if (!cursorSet) {
        const hoveredAnnotation = editingAnnotations.find(ann => {
          const [bx, by, bw, bh] = ann.bbox;
          return x >= bx && x <= bx + bw && y >= by && y <= by + bh;
        });
        
        canvas.style.cursor = hoveredAnnotation ? 'move' : 'crosshair';
      }
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = modalCanvasRef.current;
    if (!canvas) return;

    // Handle panning end
    if (isPanning) {
      setIsPanning(false);
      canvas.style.cursor = e.shiftKey ? 'grab' : 'crosshair';
      return;
    }

    if (isResizing) {
      setIsResizing(false);
      setResizeHandle(null);
      canvas.style.cursor = 'default';
      return;
    }

    if (isDragging) {
      setIsDragging(false);
      canvas.style.cursor = 'default';
      return;
    }

    if (!isDrawing) return;
    // Use the current draw position (which is updated during mouse move)
    let finalX = currentDrawPos.x;
    let finalY = currentDrawPos.y;
    
    // Apply snapping for precision
    if (zoomLevel > 2) {
      finalX = Math.round(finalX);
      finalY = Math.round(finalY);
    }

    const width = Math.abs(finalX - startPos.x);
    const height = Math.abs(finalY - startPos.y);

    // Calculate the rectangle bounds
    const rectX = Math.min(startPos.x, finalX);
    const rectY = Math.min(startPos.y, finalY);
    
    // Check if the rectangle is completely outside the image bounds
    const isCompletelyOutOfBounds = rectX >= imageWidth || rectY >= imageHeight || 
                                   rectX + width <= 0 || rectY + height <= 0;

    // Only create annotation if box is large enough and not completely out of bounds
    const minSize = Math.max(1, 5 / zoomLevel);
    if (width > minSize && height > minSize && !isCompletelyOutOfBounds) {
      // Clamp the rectangle to image bounds
      const clampedX = Math.max(0, Math.min(rectX, imageWidth));
      const clampedY = Math.max(0, Math.min(rectY, imageHeight));
      const clampedWidth = Math.min(width, imageWidth - clampedX);
      const clampedHeight = Math.min(height, imageHeight - clampedY);
      
      // Only proceed if the clamped rectangle still has meaningful size
      if (clampedWidth > 0 && clampedHeight > 0) {
        const newAnnotationData = {
          id: Date.now(), // Simple ID generation
          bbox: [
            clampedX,
            clampedY,
            clampedWidth,
            clampedHeight
          ]
        };

        // Store the pending annotation and show category selection dialog
        setPendingAnnotation(newAnnotationData);
        setShowCategoryDialog(true);
      }
    }

    setIsDrawing(false);
    canvas.style.cursor = 'crosshair';
  };

  // Handle mouse leave to clean up states
  const handleMouseLeave = () => {
    const canvas = modalCanvasRef.current;
    if (!canvas) return;

    // Clean up any ongoing operations except drawing
    setIsPanning(false);
    setIsResizing(false);
    setIsDragging(false);
    
    // Don't cancel drawing when mouse leaves - let it continue
    // The user can still finish the rectangle by clicking back on the canvas
    // or cancel with Escape key
    
    canvas.style.cursor = 'crosshair';
  };

  const handleCategorySelection = (category: Category) => {
    if (pendingAnnotation) {
      const newAnnotation: Annotation = {
        ...pendingAnnotation,
        category
      };

      setEditingAnnotations(prev => [...prev, newAnnotation]);
      setSelectedAnnotationId(newAnnotation.id);
      
      // Close dialog and reset pending annotation
      setShowCategoryDialog(false);
      setPendingAnnotation(null);
    }
  };

  const handleCancelCategorySelection = () => {
    setShowCategoryDialog(false);
    setPendingAnnotation(null);
    
    // Clear any temporary drawing artifacts
    const canvas = modalCanvasRef.current;
    if (canvas) {
      drawModalCanvas(); // Redraw without the temporary rectangle
    }
  };

  const deleteSelectedAnnotation = () => {
    if (selectedAnnotationId) {
      setEditingAnnotations(prev => 
        prev.filter(ann => ann.id !== selectedAnnotationId)
      );
      setSelectedAnnotationId(null);
    }
  };

  const updateAnnotationLabel = async (newLabel: string) => {
    if (selectedAnnotationId) {
      const selectedAnnotation = editingAnnotations.find(ann => ann.id === selectedAnnotationId);
      if (selectedAnnotation) {
        try {
          // Update the category name in the backend
          const response = await fetch(`/api/categories/${selectedAnnotation.category.id}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ name: newLabel }),
          });

          if (response.ok) {
            // Update the local state
            setEditingAnnotations(prev =>
              prev.map(ann =>
                ann.id === selectedAnnotationId
                  ? { ...ann, category: { ...ann.category, name: newLabel } }
                  : ann
              )
            );
          } else {
            console.error('Failed to update category name');
          }
        } catch (error) {
          console.error('Error updating category name:', error);
        }
      }
    }
  };

  const saveChanges = async () => {
    if (!imageId) {
      console.error('No imageId provided for saving annotations');
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch('/api/annotations', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageId: imageId,
          annotations: editingAnnotations
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to save annotations: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (result.success) {
        // Call the callback to update the parent component with new annotations
        if (onAnnotationsUpdated) {
          onAnnotationsUpdated(result.annotations);
        }
        setIsModalOpen(false);
        console.log('Annotations saved successfully');
      } else {
        throw new Error(result.error || 'Failed to save annotations');
      }
    } catch (error) {
      console.error('Error saving annotations:', error);
      // You might want to show a user-friendly error message here
      alert('Failed to save annotations. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // Modal canvas drawing effect
  useEffect(() => {
    // Only draw if modal is open, image is loaded, and we have editing annotations
    if (isModalOpen && imageLoaded && editingAnnotations.length >= 0) {
      drawModalCanvas();
    }
  }, [isModalOpen, imageLoaded, drawModalCanvas, imageSrc, editingAnnotations]); // Added editingAnnotations as dependency

  // Clean up cursor when modal closes
  useEffect(() => {
    const canvas = modalCanvasRef.current;
    if (!isModalOpen && canvas) {
      canvas.style.cursor = 'default';
    }
  }, [isModalOpen]);

  // Effect to clean up drawing state and redraw canvas
  useEffect(() => {
    // If drawing was cancelled (isDrawing became false), redraw the canvas to remove temporary rectangle
    if (!isDrawing && isModalOpen && imageLoaded) {
      const canvas = modalCanvasRef.current;
      if (canvas) {
        // Use setTimeout to ensure the state has been updated
        setTimeout(() => {
          drawModalCanvas();
        }, 0);
      }
    }
  }, [isDrawing, isModalOpen, imageLoaded, drawModalCanvas]);

  // Effect to redraw canvas when drawing position changes
  useEffect(() => {
    if (isDrawing && isModalOpen && imageLoaded) {
      drawModalCanvas();
    }
  }, [currentDrawPos, isDrawing, isModalOpen, imageLoaded, drawModalCanvas]);

  // Global mouse move handler for tracking drawing outside canvas
  const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
    if (!isDrawing || !isModalOpen) return;
    
    const canvas = modalCanvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Convert to image coordinates
    const x = mouseX / zoomLevel;
    const y = mouseY / zoomLevel;
    
    // Update current drawing position (allow drawing outside image bounds for visual feedback)
    setCurrentDrawPos({ x, y });
  }, [isDrawing, isModalOpen, zoomLevel]);

  // Global mouse up handler for finishing drawing outside canvas
  const handleGlobalMouseUp = useCallback((e: MouseEvent) => {
    if (!isDrawing || !isModalOpen) return;
    
    const canvas = modalCanvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Convert to image coordinates
    const x = mouseX / zoomLevel;
    const y = mouseY / zoomLevel;
    
    // Update current position one last time
    setCurrentDrawPos({ x, y });
    
    // Use the current draw position for final calculation
    let finalX = x;
    let finalY = y;
    
    // Apply snapping for precision
    if (zoomLevel > 2) {
      finalX = Math.round(finalX);
      finalY = Math.round(finalY);
    }

    const width = Math.abs(finalX - startPos.x);
    const height = Math.abs(finalY - startPos.y);

    // Calculate the rectangle bounds
    const rectX = Math.min(startPos.x, finalX);
    const rectY = Math.min(startPos.y, finalY);
    
    // Check if the rectangle is completely outside the image bounds
    const isCompletelyOutOfBounds = rectX >= imageWidth || rectY >= imageHeight || 
                                   rectX + width <= 0 || rectY + height <= 0;

    // Only create annotation if box is large enough and not completely out of bounds
    const minSize = Math.max(1, 5 / zoomLevel);
    if (width > minSize && height > minSize && !isCompletelyOutOfBounds) {
      // Clamp the rectangle to image bounds
      const clampedX = Math.max(0, Math.min(rectX, imageWidth));
      const clampedY = Math.max(0, Math.min(rectY, imageHeight));
      const clampedWidth = Math.min(width, imageWidth - clampedX);
      const clampedHeight = Math.min(height, imageHeight - clampedY);
      
      // Only proceed if the clamped rectangle still has meaningful size
      if (clampedWidth > 0 && clampedHeight > 0) {
        const newAnnotationData = {
          id: Date.now(), // Simple ID generation
          bbox: [
            clampedX,
            clampedY,
            clampedWidth,
            clampedHeight
          ]
        };

        // Store the pending annotation and show category selection dialog
        setPendingAnnotation(newAnnotationData);
        setShowCategoryDialog(true);
      }
    }

    setIsDrawing(false);
    canvas.style.cursor = 'crosshair';
  }, [isDrawing, isModalOpen, zoomLevel, startPos, imageWidth, imageHeight]);

  // Add global mouse listeners when drawing
  useEffect(() => {
    if (isDrawing && isModalOpen) {
      document.addEventListener('mousemove', handleGlobalMouseMove);
      document.addEventListener('mouseup', handleGlobalMouseUp);
      
      return () => {
        document.removeEventListener('mousemove', handleGlobalMouseMove);
        document.removeEventListener('mouseup', handleGlobalMouseUp);
      };
    }
  }, [isDrawing, isModalOpen, handleGlobalMouseMove, handleGlobalMouseUp]);

  return (
    <div className="border rounded-lg p-4 bg-white shadow-lg">
      <h3 className="text-lg font-semibold mb-2 text-gray-800">{fileName}</h3>
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-1">
          <div className="flex justify-between items-center mb-2">
            <div></div>
            <button
              onClick={() => setIsModalOpen(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              Bounding Box
            </button>
          </div>
          <div className="relative inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imageRef}
              src={imageSrc}
              alt={fileName}
              className="hidden"
              onLoad={() => setImageLoaded(true)}
              onError={(e) => {
                console.error('Error loading image:', e);
                setImageLoaded(false);
              }}
            />
            
            {/* Loading spinner overlay */}
            {!imageLoaded && (
              <div 
                className="flex items-center justify-center border border-gray-500 rounded bg-gray-200"
                style={{ 
                  width: canvasSize.width || 400, 
                  height: canvasSize.height || 300,
                  minWidth: 200,
                  minHeight: 150
                }}
              >
                <div className="flex flex-col items-center space-y-3">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  <p className="text-sm text-gray-700">Loading image...</p>
                </div>
              </div>
            )}
            
            {/* Canvas - only show when image is loaded */}
            {imageLoaded && (
              <canvas
                ref={canvasRef}
                width={canvasSize.width}
                height={canvasSize.height}
                className="border border-gray-500 rounded"
                style={{ maxWidth: '100%', height: 'auto' }}
              />
            )}
          </div>
          <p className="text-sm text-gray-600 mt-2">
            Original: {imageWidth} × {imageHeight}px | 
            Display: {Math.round(canvasSize.width)} × {Math.round(canvasSize.height)}px
          </p>
        </div>
        
        <div className="lg:w-64">
          <h4 className="font-semibold mb-2 text-gray-800">Annotations ({annotations.length})</h4>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {annotations.map((annotation) => (
              <div
                key={annotation.id}
                className="p-2 rounded border-l-4 bg-gray-100"
                style={{ borderLeftColor: categoryColors.get(annotation.category.id) }}
              >
                <div className="font-medium text-sm text-black">{annotation.category.name}</div>
                {annotation.category.supercategory && (
                  <div className="text-xs text-gray-850">{annotation.category.supercategory}</div>
                )}
                <div className="text-xs text-gray-500 mt-1">
                  [{annotation.bbox.map(n => Math.round(n)).join(', ')}]
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Modal for editing bounding boxes */}
      {isModalOpen && (
        <div 
          key={`modal-${imageSrc}-${imageId}`} // Force remount when image changes
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
        >
          <div className="bg-white rounded-lg flex relative" style={{
            width: 'calc(100vw - 2rem)',
            height: 'calc(100vh - 2rem)',
            maxWidth: 'calc(100vw - 2rem)',
            maxHeight: 'calc(100vh - 2rem)'
          }}>
            {/* Navigation Arrows - positioned at modal level */}
            {hasPrevious && (
              <button
                onClick={onNavigatePrevious}
                className="absolute left-8 top-1/2 transform -translate-y-1/2 z-50 bg-black bg-opacity-60 hover:bg-opacity-80 text-white p-3 rounded-full transition-all duration-200 shadow-lg"
                title="Previous Image (←)"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            
            {hasNext && (
              <button
                onClick={onNavigateNext}
                className="absolute top-1/2 transform -translate-y-1/2 z-50 bg-black bg-opacity-60 hover:bg-opacity-80 text-white p-3 rounded-full transition-all duration-200 shadow-lg"
                title="Next Image (→)"
                style={{ right: 'calc(20rem + 2rem)' }}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}
            
            <div className="flex-1 flex flex-col min-w-0 p-2 relative" ref={modalContainerRef}>
              {/* Canvas Container - Full height priority with scroll if needed */}
              <div 
                className="relative overflow-auto border border-gray-500 rounded bg-gray-200"
                style={{ 
                  flex: '1 1 auto', 
                  minHeight: 0,
                  height: '100%',
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'flex-start'
                }}
              >
                {/* Hidden image for modal */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={modalImageRef}
                  src={imageSrc}
                  alt={fileName}
                  className="hidden"
                />

                {/* Loading overlay for modal canvas */}
                {!imageLoaded && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gray-200 z-10">
                    <div className="flex flex-col items-center space-y-3">
                      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                      <p className="text-sm text-gray-700">Loading image...</p>
                    </div>
                  </div>
                )}

                {/* Canvas - only show when image is loaded */}
                {imageLoaded && (
                  <canvas
                    ref={modalCanvasRef}
                    width={modalCanvasSize.width}
                    height={modalCanvasSize.height}
                    className="cursor-crosshair"
                    style={{ 
                      display: 'block',
                      position: 'absolute',
                      left: panOffset.x,
                      top: panOffset.y
                    }}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseLeave}
                    onWheel={handleWheel}
                  />
                )}
              </div>
            </div>

            <div className="w-80 bg-white border-l border-gray-400 flex-shrink-0 flex flex-col min-h-0 p-4">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-semibold text-gray-800">Edit Bounding Boxes</h3>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="text-gray-600 hover:text-gray-800 text-2xl ml-2"
                  title="Close"
                >
                  ×
                </button>
              </div>
              
              <div className="space-y-4 h-full flex flex-col">
                {/* Image Info */}
                <div className="bg-gray-100 p-4 rounded-lg flex-shrink-0">
                  <h4 className="text-sm font-medium mb-2 text-gray-800 truncate" title={fileName}>{fileName}</h4>
                  <div className="text-sm text-gray-800 space-y-1">
                    <p>Size: {imageWidth} × {imageHeight}px</p>
                    <p>Zoom: {Math.round(zoomLevel * 100)}%</p>
                    <p>Pan: {Math.round(panOffset.x)}, {Math.round(panOffset.y)}</p>
                  </div>
                </div>

                {/* Zoom Controls */}
                <div className="bg-gray-100 p-3 rounded-lg flex-shrink-0">
                  <h4 className="font-semibold mb-3 text-gray-800">Zoom Controls</h4>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={zoomOut}
                        className="p-2 bg-white border border-gray-500 rounded hover:bg-gray-200 transition-colors"
                        title="Zoom Out (-)"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                        </svg>
                      </button>
                      
                      <div className="px-3 py-1 bg-white border border-gray-500 rounded text-sm font-mono min-w-[80px] text-center">
                        {Math.round(zoomLevel * 100)}%
                      </div>
                      
                      <button
                        onClick={zoomIn}
                        className="p-2 bg-white border border-gray-500 rounded hover:bg-gray-200 transition-colors"
                        title="Zoom In (+)"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      </button>
                    </div>
                    
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={zoomToFit}
                        className="px-3 py-2 bg-white border border-gray-500 rounded hover:bg-gray-200 transition-colors text-sm"
                        title="Fit to Window (F)"
                      >
                        Fit
                      </button>
                      
                      <button
                        onClick={zoomToActualSize}
                        className="px-3 py-2 bg-white border border-gray-500 rounded hover:bg-gray-200 transition-colors text-sm"
                        title="Actual Size (0)"
                      >
                        1:1
                      </button>
                      
                      {selectedAnnotationId && (
                        <button
                          onClick={zoomToSelection}
                          className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm"
                          title="Zoom to Selected"
                        >
                          Zoom to Selection
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {selectedAnnotationId && (
                  <div className="bg-blue-50 p-4 rounded-lg flex-shrink-0">
                    <h4 className="font-semibold mb-2 text-gray-800">Edit Selected Annotation</h4>
                    <div className="space-y-3">
                      <label className="block">
                        <span className="text-sm font-medium text-gray-700">Label:</span>
                        <input
                          type="text"
                          value={editingAnnotations.find(ann => ann.id === selectedAnnotationId)?.category.name || ''}
                          onChange={(e) => {
                            // Update local state immediately for responsive UI
                            setEditingAnnotations(prev =>
                              prev.map(ann =>
                                ann.id === selectedAnnotationId
                                  ? { ...ann, category: { ...ann.category, name: e.target.value } }
                                  : ann
                              )
                            );
                          }}
                          onBlur={async (e) => {
                            // Save to backend when user finishes editing
                            await updateAnnotationLabel(e.target.value);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              (e.target as HTMLInputElement).blur(); // Trigger onBlur to save
                            }
                          }}
                          className="w-full mt-1 px-3 py-2 border border-gray-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Enter category name"
                        />
                      </label>
                      
                      {/* Precise coordinate editing */}
                      {(() => {
                        const selectedAnnotation = editingAnnotations.find(ann => ann.id === selectedAnnotationId);
                        if (!selectedAnnotation) return null;
                        
                        const [x, y, width, height] = selectedAnnotation.bbox;
                        return (
                          <div className="grid grid-cols-2 gap-2">
                            <label className="block">
                              <span className="text-xs font-medium text-gray-700">X:</span>
                              <input
                                type="number"
                                value={Math.round(x)}
                                onChange={(e) => {
                                  const newX = Math.max(0, Math.min(parseInt(e.target.value) || 0, imageWidth - width));
                                  setEditingAnnotations(prev =>
                                    prev.map(ann =>
                                      ann.id === selectedAnnotationId
                                        ? { ...ann, bbox: [newX, y, width, height] }
                                        : ann
                                    )
                                  );
                                }}
                                className="w-full mt-1 px-2 py-1 border border-gray-500 rounded text-xs"
                                min="0"
                                max={imageWidth - width}
                              />
                            </label>
                            
                            <label className="block">
                              <span className="text-xs font-medium text-gray-700">Y:</span>
                              <input
                                type="number"
                                value={Math.round(y)}
                                onChange={(e) => {
                                  const newY = Math.max(0, Math.min(parseInt(e.target.value) || 0, imageHeight - height));
                                  setEditingAnnotations(prev =>
                                    prev.map(ann =>
                                      ann.id === selectedAnnotationId
                                        ? { ...ann, bbox: [x, newY, width, height] }
                                        : ann
                                    )
                                  );
                                }}
                                className="w-full mt-1 px-2 py-1 border border-gray-500 rounded text-xs"
                                min="0"
                                max={imageHeight - height}
                              />
                            </label>
                            
                            <label className="block">
                              <span className="text-xs font-medium text-gray-700">Width:</span>
                              <input
                                type="number"
                                value={Math.round(width)}
                                onChange={(e) => {
                                  const newWidth = Math.max(1, Math.min(parseInt(e.target.value) || 1, imageWidth - x));
                                  setEditingAnnotations(prev =>
                                    prev.map(ann =>
                                      ann.id === selectedAnnotationId
                                        ? { ...ann, bbox: [x, y, newWidth, height] }
                                        : ann
                                    )
                                  );
                                }}
                                className="w-full mt-1 px-2 py-1 border border-gray-500 rounded text-xs"
                                min="1"
                                max={imageWidth - x}
                              />
                            </label>
                            
                            <label className="block">
                              <span className="text-xs font-medium text-gray-700">Height:</span>
                              <input
                                type="number"
                                value={Math.round(height)}
                                onChange={(e) => {
                                  const newHeight = Math.max(1, Math.min(parseInt(e.target.value) || 1, imageHeight - y));
                                  setEditingAnnotations(prev =>
                                    prev.map(ann =>
                                      ann.id === selectedAnnotationId
                                        ? { ...ann, bbox: [x, y, width, newHeight] }
                                        : ann
                                    )
                                  );
                                }}
                                className="w-full mt-1 px-2 py-1 border border-gray-500 rounded text-xs"
                                min="1"
                                max={imageHeight - y}
                              />
                            </label>
                          </div>
                        );
                      })()}
                      
                      <button
                        onClick={deleteSelectedAnnotation}
                        className="w-full px-3 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                      >
                        Delete Annotation
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex-1 min-h-0 flex flex-col">
                  <h4 className="font-semibold mb-2 flex-shrink-0 text-gray-800">All Annotations ({editingAnnotations.length})</h4>
                  <div className="space-y-2 overflow-y-auto flex-1">
                    {!imageLoaded ? (
                      <div className="flex items-center justify-center p-4 text-gray-500">
                        <div className="flex flex-col items-center space-y-2">
                          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400"></div>
                          <span className="text-xs">Loading annotations...</span>
                        </div>
                      </div>
                    ) : editingAnnotations.length === 0 ? (
                      <div className="text-center text-gray-500 p-4">
                        <p className="text-sm">No annotations yet.</p>
                        <p className="text-xs mt-1">Click and drag on the image to create bounding boxes.</p>
                        <p className="text-xs mt-1 text-gray-400">Press Escape to cancel drawing.</p>
                      </div>
                    ) : (
                      editingAnnotations.map((annotation) => (
                        <div
                          key={annotation.id}
                          className={`p-2 rounded border cursor-pointer ${
                            selectedAnnotationId === annotation.id
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-gray-400 bg-gray-100 hover:bg-gray-200'
                          }`}
                          onClick={() => setSelectedAnnotationId(annotation.id)}
                        >
                          <div className="font-medium text-sm text-gray-800">{annotation.category.name}</div>
                          <div className="text-xs text-gray-600">
                            [{annotation.bbox.map(n => Math.round(n)).join(', ')}]
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="flex gap-2 pt-4 border-t flex-shrink-0">
                  <button
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 px-4 py-2 border border-gray-500 text-gray-800 rounded hover:bg-gray-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveChanges}
                    disabled={isSaving}
                    className="flex-1 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-green-400 disabled:cursor-not-allowed transition-colors"
                  >
                    {isSaving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Category Selection Dialog */}
      {showCategoryDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Select Category</h3>
            <p className="text-sm text-gray-950 mb-4">
              Choose a category for the new bounding box:
            </p>
            
            {availableCategories.length > 0 ? (
              <div className="space-y-2 max-h-64 overflow-y-auto mb-4">
                {availableCategories.map((category) => (
                  <button
                    key={category.id}
                    onClick={() => handleCategorySelection(category)}
                    className="w-full p-3 text-left border border-gray-400 rounded hover:bg-blue-50 hover:border-blue-300 transition-colors"
                  >
                    <div className="font-medium text-gray-800">{category.name}</div>
                    {category.supercategory && (
                      <div className="text-xs text-gray-500">{category.supercategory}</div>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-center text-gray-600 mb-4 p-4 border border-gray-400 rounded">
                No categories available for this dataset.
                <br />
                <span className="text-xs">Categories will be created automatically when you save.</span>
              </div>
            )}
            
            <div className="flex gap-2">
              <button
                onClick={handleCancelCategorySelection}
                className="flex-1 px-4 py-2 border border-gray-500 text-gray-800 rounded hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              {availableCategories.length === 0 && (
                <button
                  onClick={() => handleCategorySelection({ id: 0, name: 'New Object' })}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                >
                  Create New Category
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
