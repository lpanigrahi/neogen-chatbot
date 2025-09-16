"use client";

import { useCallback, useState, useRef } from "react";
import {
  Upload,
  X,
  FileIcon,
  ImageIcon,
  FileSpreadsheet,
  FileText,
} from "lucide-react";
import { Button } from "ui/button";
import { cn } from "lib/utils";
import { toast } from "sonner";
import { UploadResponse } from "@/app/api/upload/route";

export interface FileAttachment {
  id: string;
  filename: string;
  originalName: string;
  size: number;
  type: string;
  url: string;
  uploadedAt: string;
}

interface FileUploadProps {
  onFilesSelected: (files: FileAttachment[]) => void;
  selectedFiles: FileAttachment[];
  onRemoveFile: (fileId: string) => void;
  maxFiles?: number;
  className?: string;
}

const ALLOWED_FILE_TYPES = [
  // Images
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  // Documents
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  // Spreadsheets
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  // Code files
  "text/javascript",
  "application/typescript",
  "text/x-python",
  "application/json",
  // Archives
  "application/zip",
];

const ALLOWED_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".pdf",
  ".txt",
  ".md",
  ".docx",
  ".xls",
  ".xlsx",
  ".csv",
  ".js",
  ".ts",
  ".py",
  ".json",
  ".zip",
];

function getFileIcon(type: string, filename: string) {
  if (type.startsWith("image/")) return ImageIcon;
  if (
    type.includes("spreadsheet") ||
    type.includes("excel") ||
    type === "text/csv" ||
    filename.includes(".xls")
  )
    return FileSpreadsheet;
  if (type.includes("text/") || type.includes("document")) return FileText;
  return FileIcon;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export function FileUpload({
  onFilesSelected,
  selectedFiles,
  onRemoveFile,
  maxFiles = 5,
  className,
}: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFile = useCallback((file: File): boolean => {
    const fileExtension = file.name.split(".").pop()?.toLowerCase();

    // Check file type and extension
    const isValidType =
      ALLOWED_FILE_TYPES.includes(file.type) ||
      ALLOWED_EXTENSIONS.includes(`.${fileExtension}`);

    if (!isValidType) {
      toast.error(`File type not supported: ${file.name}`);
      return false;
    }

    // Check file size (10MB limit)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error(`File too large: ${file.name} (max 10MB)`);
      return false;
    }

    return true;
  }, []);

  const uploadFile = useCallback(
    async (file: File): Promise<FileAttachment | null> => {
      const formData = new FormData();
      formData.append("file", file);

      try {
        const response = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Upload failed");
        }

        const result: UploadResponse = await response.json();
        return result;
      } catch (error: any) {
        toast.error(`Failed to upload ${file.name}: ${error.message}`);
        return null;
      }
    },
    [],
  );

  const handleFiles = useCallback(
    async (files: FileList) => {
      const fileArray = Array.from(files);

      // Check max files limit
      if (selectedFiles.length + fileArray.length > maxFiles) {
        toast.error(`Maximum ${maxFiles} files allowed`);
        return;
      }

      // Validate all files first
      const validFiles = fileArray.filter(validateFile);
      if (validFiles.length === 0) return;

      setIsUploading(true);

      try {
        const uploadPromises = validFiles.map(uploadFile);
        const uploadResults = await Promise.all(uploadPromises);
        const successfulUploads = uploadResults.filter(
          (result): result is FileAttachment => result !== null,
        );

        if (successfulUploads.length > 0) {
          onFilesSelected([...selectedFiles, ...successfulUploads]);
          toast.success(
            `${successfulUploads.length} file(s) uploaded successfully`,
          );
        }
      } catch (_error) {
        toast.error("Upload failed");
      } finally {
        setIsUploading(false);
      }
    },
    [selectedFiles, maxFiles, validateFile, uploadFile, onFilesSelected],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        handleFiles(e.target.files);
      }
    },
    [handleFiles],
  );

  const openFileDialog = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return (
    <div className={cn("space-y-4", className)}>
      {/* File Upload Area */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={openFileDialog}
        className={cn(
          "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
          isDragging
            ? "border-primary bg-primary/10"
            : "border-muted-foreground/25 hover:border-muted-foreground/50",
          isUploading && "pointer-events-none opacity-50",
        )}
      >
        <Upload className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">
          {isUploading
            ? "Uploading..."
            : "Drag & drop files here or click to browse"}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Supports images, documents, spreadsheets, and more (max 10MB each)
        </p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileInput}
        accept={ALLOWED_EXTENSIONS.join(",")}
        className="hidden"
      />

      {/* Selected Files */}
      {selectedFiles.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            Selected Files ({selectedFiles.length}/{maxFiles})
          </p>
          {selectedFiles.map((file) => {
            const FileIconComponent = getFileIcon(file.type, file.originalName);
            return (
              <div
                key={file.id}
                className="flex items-center gap-3 p-3 bg-muted rounded-lg"
              >
                <FileIconComponent className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {file.originalName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(file.size)} • {file.type}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveFile(file.id);
                  }}
                  className="flex-shrink-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
