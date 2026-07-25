/**
 * IndexedDB storage for historical Olive optimization runs.
 * Supports persistent storage, querying, and side-by-side comparison of job history.
 */

export interface JobHistoryRecord {
  id: string; // UUID or jobId
  jobId: string;
  timestamp: string; // ISO date string
  modelId: string;
  ihvProvider: string;
  memoryOffload: string;
  status: "completed" | "failed" | "cancelled";
  exitCode: number | null;
  durationMs: number;
  passCount: number;
  passNames: string[];
  recipeJson: string;
  vramEstimateGb?: number;
  logSummary?: {
    totalLogs: number;
    errorCount: number;
    lastLog?: string;
  };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || isNumber(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => isString(v));
}

function isValidStatus(value: unknown): value is JobHistoryRecord["status"] {
  return value === "completed" || value === "failed" || value === "cancelled";
}

function isValidLogSummary(value: unknown): value is JobHistoryRecord["logSummary"] {
  if (value === undefined) return true;
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    isNumber(obj.totalLogs) &&
    isNumber(obj.errorCount) &&
    (obj.lastLog === undefined || isString(obj.lastLog))
  );
}

export function isJobHistoryRecord(value: unknown): value is JobHistoryRecord {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    isString(obj.id) &&
    isString(obj.jobId) &&
    isString(obj.timestamp) &&
    isString(obj.modelId) &&
    isString(obj.ihvProvider) &&
    isString(obj.memoryOffload) &&
    isValidStatus(obj.status) &&
    (obj.exitCode === null || isNumber(obj.exitCode)) &&
    isNumber(obj.durationMs) &&
    isNumber(obj.passCount) &&
    isStringArray(obj.passNames) &&
    isString(obj.recipeJson) &&
    isOptionalNumber(obj.vramEstimateGb) &&
    isValidLogSummary(obj.logSummary)
  );
}

const DB_NAME = "OliveStudioHistoryDB";
const DB_VERSION = 1;
const STORE_NAME = "job_history";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not supported in this environment."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("timestamp", "timestamp", { unique: false });
        store.createIndex("modelId", "modelId", { unique: false });
        store.createIndex("status", "status", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveJobHistory(record: JobHistoryRecord): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);
      req.onsuccess = () => {
        const countReq = store.count();
        countReq.onsuccess = () => {
          if (countReq.result > 100) {
            const getAllReq = store.getAll();
            getAllReq.onsuccess = () => {
              const all = getAllReq.result as JobHistoryRecord[];
              all.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
              const toDelete = all.slice(0, all.length - 100);
              for (const item of toDelete) {
                store.delete(item.id);
              }
              resolve();
            };
            getAllReq.onerror = () => resolve();
          } else {
            resolve();
          }
        };
        countReq.onerror = () => resolve();
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error("Failed to save job history to IndexedDB:", err);
  }
}

export async function getJobHistoryRaw(): Promise<JobHistoryRecord[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();

    req.onsuccess = () => {
      const results = req.result as JobHistoryRecord[];
      // Sort descending by timestamp
      results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      resolve(results);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getJobHistory(): Promise<JobHistoryRecord[]> {
  try {
    return await getJobHistoryRaw();
  } catch (err) {
    console.error("Failed to fetch job history from IndexedDB:", err);
    return [];
  }
}

export async function deleteJobHistoryRecord(id: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error("Failed to delete job history record from IndexedDB:", err);
  }
}

export async function clearAllJobHistory(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error("Failed to clear job history in IndexedDB:", err);
  }
}

export interface JobHistoryExportEnvelope {
  version: number;
  records: JobHistoryRecord[];
}

/** Export the full job history as a versioned JSON envelope. */
export async function exportJobHistory(): Promise<string> {
  const records = await getJobHistoryRaw();
  const envelope: JobHistoryExportEnvelope = { version: 1, records };
  return JSON.stringify(envelope, null, 2);
}

/** Trigger a browser download of the job history as JSON. */
export async function exportJobHistoryToFile(filename = "olive-job-history.json"): Promise<void> {
  const json = await exportJobHistory();
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function isValidExportEnvelope(value: unknown): value is JobHistoryExportEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return isNumber(obj.version) && obj.version === 1 && Array.isArray(obj.records);
}

/**
 * Import a versioned job-history envelope into IndexedDB.
 * Unsupported or malformed envelopes are rejected explicitly.
 * Invalid entries inside a valid version-1 envelope are skipped.
 * Valid entries are written via put (overwrites existing records with the same id).
 */
export async function importJobHistory(data: unknown): Promise<{ imported: number; skipped: number }> {
  if (!isValidExportEnvelope(data)) {
    throw new Error("Invalid job history export: expected { version: 1, records: [...] }.");
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    let imported = 0;
    let skipped = 0;

    for (const item of data.records) {
      if (isJobHistoryRecord(item)) {
        store.put(item);
        imported += 1;
      } else {
        skipped += 1;
      }
    }

    tx.oncomplete = () => resolve({ imported, skipped });
    tx.onerror = () => reject(tx.error);
  });
}

/** Read a JSON file and import its contents as job history. */
export async function importJobHistoryFromFile(file: File): Promise<{ imported: number; skipped: number }> {
  const text = await file.text();
  const parsed = JSON.parse(text);
  return importJobHistory(parsed);
}
