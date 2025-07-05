// In-memory storage for merge progress
// In production, you might want to use Redis or a database
const mergeProgress = new Map<
  string,
  {
    total: number;
    current: number;
    currentOperation: string;
    errors: string[];
    completed: boolean;
    success?: boolean;
    result?: unknown;
  }
>();

export function getMergeProgress(mergeId: string) {
  return mergeProgress.get(mergeId);
}

export function updateMergeProgress(
  mergeId: string,
  current: number,
  total: number,
  currentOperation: string,
  error?: string
) {
  const existing = mergeProgress.get(mergeId) || {
    total: 0,
    current: 0,
    currentOperation: "",
    errors: [],
    completed: false,
  };

  existing.total = total;
  existing.current = current;
  existing.currentOperation = currentOperation;

  if (error) {
    existing.errors.push(error);
  }

  mergeProgress.set(mergeId, existing);
}

export function completeMergeProgress(
  mergeId: string,
  success: boolean,
  result?: unknown
) {
  const existing = mergeProgress.get(mergeId);
  if (existing) {
    existing.completed = true;
    existing.success = success;
    existing.result = result;
    mergeProgress.set(mergeId, existing);
  }
}

export function initializeMergeProgress(mergeId: string, total: number) {
  mergeProgress.set(mergeId, {
    total,
    current: 0,
    currentOperation: "Initializing merge...",
    errors: [],
    completed: false,
  });
}

export function cleanupMergeProgress(mergeId: string) {
  // Clean up after 5 minutes
  setTimeout(() => {
    mergeProgress.delete(mergeId);
  }, 5 * 60 * 1000);
}
