import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { getSession } from "auth/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string; filename: string }> },
) {
  try {
    const session = await getSession();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const resolvedParams = await params;

    // Check if user is accessing their own files or has permission
    if (session.user.id !== resolvedParams.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const filePath = path.join(
      process.cwd(),
      "uploads",
      resolvedParams.userId,
      resolvedParams.filename,
    );

    if (!existsSync(filePath)) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const fileBuffer = await readFile(filePath);
    const fileExtension = path.extname(resolvedParams.filename).toLowerCase();

    // Determine content type based on file extension
    const contentTypeMap: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".pdf": "application/pdf",
      ".txt": "text/plain",
      ".md": "text/markdown",
      ".docx":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".xls": "application/vnd.ms-excel",
      ".xlsx":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".csv": "text/csv",
      ".js": "text/javascript",
      ".ts": "application/typescript",
      ".py": "text/x-python",
      ".json": "application/json",
      ".zip": "application/zip",
    };

    const contentType =
      contentTypeMap[fileExtension] || "application/octet-stream";

    return new NextResponse(new Uint8Array(fileBuffer), {
      headers: {
        "Content-Type": contentType,
        "Content-Length": fileBuffer.length.toString(),
        "Cache-Control": "public, max-age=86400", // 24 hours
      },
    });
  } catch (error: any) {
    console.error("File serving error:", error);
    return NextResponse.json({ error: "File serving failed" }, { status: 500 });
  }
}
