import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { getSession } from "auth/server";
import { generateUUID } from "lib/utils";
import { z } from "zod";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const ALLOWED_FILE_TYPES = {
  // Images
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
  // Documents
  "application/pdf": [".pdf"],
  "text/plain": [".txt"],
  "text/markdown": [".md"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    ".docx",
  ],
  // Spreadsheets
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
    ".xlsx",
  ],
  "text/csv": [".csv"],
  // Code files
  "text/javascript": [".js"],
  "application/typescript": [".ts"],
  "text/x-python": [".py"],
  "application/json": [".json"],
  // Archives
  "application/zip": [".zip"],
};

const uploadResponseSchema = z.object({
  id: z.string(),
  filename: z.string(),
  originalName: z.string(),
  size: z.number(),
  type: z.string(),
  url: z.string(),
  uploadedAt: z.string(),
});

export type UploadResponse = z.infer<typeof uploadResponseSchema>;

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` },
        { status: 400 },
      );
    }

    // Validate file type
    const fileExtension = path.extname(file.name).toLowerCase();
    const isValidType = Object.entries(ALLOWED_FILE_TYPES).some(
      ([mimeType, extensions]) =>
        file.type === mimeType || extensions.includes(fileExtension),
    );

    if (!isValidType) {
      return NextResponse.json(
        { error: "File type not supported" },
        { status: 400 },
      );
    }

    // Create upload directory if it doesn't exist
    const uploadDir = path.join(process.cwd(), "uploads", session.user.id);
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    // Generate unique filename
    const fileId = generateUUID();
    const filename = `${fileId}${fileExtension}`;
    const filePath = path.join(uploadDir, filename);

    // Convert file to buffer and save
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(filePath, buffer);

    // Create response
    const response: UploadResponse = {
      id: fileId,
      filename,
      originalName: file.name,
      size: file.size,
      type: file.type || `application/${fileExtension.slice(1)}`,
      url: `/api/files/${session.user.id}/${filename}`,
      uploadedAt: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error: any) {
    console.error("Upload error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
