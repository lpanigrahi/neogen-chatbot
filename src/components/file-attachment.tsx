"use client";

import { useState, useMemo } from "react";
import {
  Download,
  FileIcon,
  ImageIcon,
  FileSpreadsheet,
  FileText,
  Eye,
  ExternalLink,
} from "lucide-react";
import { Button } from "ui/button";
import { cn } from "lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "ui/dialog";
import { FileAttachment } from "./file-upload";

interface FileAttachmentDisplayProps {
  file: FileAttachment;
  className?: string;
  showPreview?: boolean;
}

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

function isImageType(type: string): boolean {
  return type.startsWith("image/");
}

function isSpreadsheetType(type: string, filename: string): boolean {
  return (
    type.includes("spreadsheet") ||
    type.includes("excel") ||
    type === "text/csv" ||
    filename.endsWith(".xls") ||
    filename.endsWith(".xlsx") ||
    filename.endsWith(".csv")
  );
}

export function FileAttachmentDisplay({
  file,
  className,
  showPreview = true,
}: FileAttachmentDisplayProps) {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewError, setPreviewError] = useState(false);

  const FileIconComponent = getFileIcon(file.type, file.originalName);

  const isImage = isImageType(file.type);
  const isSpreadsheet = isSpreadsheetType(file.type, file.originalName);
  const canPreview = isImage || isSpreadsheet || file.type.includes("text/");

  const handleDownload = async () => {
    try {
      const response = await fetch(file.url);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.originalName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Download failed:", error);
    }
  };

  const openInNewTab = () => {
    window.open(file.url, "_blank");
  };

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-3 p-3 bg-card border rounded-lg hover:shadow-sm transition-shadow",
          className,
        )}
      >
        <div className="flex-shrink-0 p-2 bg-muted rounded">
          <FileIconComponent className="h-6 w-6 text-muted-foreground" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" title={file.originalName}>
            {file.originalName}
          </p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{formatFileSize(file.size)}</span>
            <span>•</span>
            <span className="capitalize">
              {file.type.split("/")[1] || file.originalName.split(".").pop()}
            </span>
            {isSpreadsheet && (
              <>
                <span>•</span>
                <span>Spreadsheet</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          {showPreview && canPreview && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsPreviewOpen(true)}
              className="h-8 w-8 p-0"
            >
              <Eye className="h-4 w-4" />
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={openInNewTab}
            className="h-8 w-8 p-0"
          >
            <ExternalLink className="h-4 w-4" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleDownload}
            className="h-8 w-8 p-0"
          >
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Preview Dialog */}
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>{file.originalName}</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-hidden">
            {isImage && !previewError ? (
              <div className="flex items-center justify-center max-h-[60vh] overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={file.url}
                  alt={file.originalName}
                  className="max-w-full max-h-full object-contain rounded"
                  onError={() => setPreviewError(true)}
                />
              </div>
            ) : isSpreadsheet ? (
              <div className="space-y-4 max-h-[60vh] overflow-auto">
                <SpreadsheetPreview file={file} />
              </div>
            ) : file.type.includes("text/") && !previewError ? (
              <div className="max-h-[60vh] overflow-auto">
                <TextFilePreview file={file} />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <FileIconComponent className="h-16 w-16 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">
                  {previewError
                    ? "Preview not available"
                    : "Preview not supported for this file type"}
                </p>
                <Button
                  variant="outline"
                  onClick={openInNewTab}
                  className="mt-4"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open in new tab
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SpreadsheetPreview({ file }: { file: FileAttachment }) {
  const [csvData, setCsvData] = useState<string[][] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useMemo(async () => {
    if (file.type === "text/csv" || file.originalName.endsWith(".csv")) {
      try {
        const response = await fetch(file.url);
        const text = await response.text();
        const rows = text
          .split("\n")
          .map((row) =>
            row.split(",").map((cell) => cell.trim().replace(/^"(.*)"$/, "$1")),
          )
          .filter((row) => row.some((cell) => cell.length > 0));
        setCsvData(rows);
      } catch (_err) {
        setError("Failed to load spreadsheet data");
      } finally {
        setLoading(false);
      }
    } else {
      setError("Spreadsheet preview only available for CSV files");
      setLoading(false);
    }
  }, [file]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (error || !csvData) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <FileSpreadsheet className="h-16 w-16 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">
          {error || "Unable to preview this spreadsheet"}
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          Download the file to view in a spreadsheet application
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">
        Showing {Math.min(csvData.length, 100)} of {csvData.length} rows
      </div>
      <div className="overflow-auto border rounded">
        <table className="min-w-full text-xs">
          <thead className="bg-muted">
            {csvData[0] && (
              <tr>
                {csvData[0].map((header, index) => (
                  <th
                    key={index}
                    className="px-3 py-2 text-left font-medium border-r last:border-r-0"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {csvData.slice(1, 101).map((row, rowIndex) => (
              <tr key={rowIndex} className="border-t hover:bg-muted/50">
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className="px-3 py-2 border-r last:border-r-0"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {csvData.length > 100 && (
        <p className="text-xs text-muted-foreground text-center">
          ... and {csvData.length - 100} more rows
        </p>
      )}
    </div>
  );
}

function TextFilePreview({ file }: { file: FileAttachment }) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useMemo(async () => {
    try {
      const response = await fetch(file.url);
      const text = await response.text();
      setContent(text);
    } catch (_err) {
      setError("Failed to load file content");
    } finally {
      setLoading(false);
    }
  }, [file]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (error || !content) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <FileText className="h-16 w-16 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">
          {error || "Unable to preview this file"}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-muted p-4 rounded font-mono text-xs whitespace-pre-wrap">
      {content.length > 10000
        ? content.substring(0, 10000) + "\n\n... (truncated)"
        : content}
    </div>
  );
}
