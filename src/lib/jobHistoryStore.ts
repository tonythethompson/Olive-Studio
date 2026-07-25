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

export async function getJobHistory(): Promise<JobHistoryRecord[]> {
  try {
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
