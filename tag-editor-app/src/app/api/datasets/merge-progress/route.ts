import { NextResponse } from "next/server";
import { getMergeProgress } from "@/lib/merge-progress";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mergeId = searchParams.get("mergeId");

    if (!mergeId) {
      return NextResponse.json(
        { error: "Merge ID is required" },
        { status: 400 }
      );
    }

    const progress = getMergeProgress(mergeId);

    if (!progress) {
      return NextResponse.json(
        { error: "Merge progress not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      total: progress.total,
      current: progress.current,
      currentOperation: progress.currentOperation,
      percentage:
        progress.total > 0
          ? Math.round((progress.current / progress.total) * 100)
          : 0,
      errors: progress.errors,
      completed: progress.completed,
      success: progress.success,
      result: progress.result,
    });
  } catch (error) {
    console.error("Failed to get merge progress:", error);
    return NextResponse.json(
      { error: "Failed to get merge progress" },
      { status: 500 }
    );
  }
}
