/**
 * Error frequency tracker for grouping repeated crashes from the same component.
 *
 * Tracks errors by a composite key (component label + error message hash) and
 * provides frequency information for reports.
 */

export interface ErrorFrequencyEntry {
  /** Number of times this error has occurred */
  count: number;
  /** Timestamp of first occurrence */
  firstOccurrence: number;
  /** Timestamp of last occurrence */
  lastOccurrence: number;
  /** Component label where the error occurred */
  componentLabel: string;
  /** Error message (truncated for storage) */
  errorMessage: string;
}

export interface ErrorFrequencyInfo {
  /** Total occurrences of this specific error */
  count: number;
  /** How many seconds ago the first occurrence was */
  firstOccurrenceAgo: number;
  /** How many seconds ago the last occurrence was */
  lastOccurrenceAgo: number;
  /** Human-readable frequency description */
  frequencyLabel: string;
}

/** Maximum age of entries before they're pruned (1 hour in ms) */
const MAX_ENTRY_AGE_MS = 60 * 60 * 1000;

/** Maximum number of entries to store */
const MAX_ENTRIES = 100;

class ErrorFrequencyTracker {
  private entries = new Map<string, ErrorFrequencyEntry>();

  /**
   * Generate a key for an error based on component label and message.
   */
  private makeKey(componentLabel: string, errorMessage: string): string {
    // Simple hash of the message to keep keys manageable
    const msgHash = this.simpleHash(errorMessage);
    return `${componentLabel}:${msgHash}`;
  }

  /**
   * Simple string hash for grouping similar errors.
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Prune entries older than MAX_ENTRY_AGE_MS or if we exceed MAX_ENTRIES.
   */
  private prune(): void {
    const now = Date.now();

    // Remove expired entries
    for (const [key, entry] of this.entries) {
      if (now - entry.lastOccurrence > MAX_ENTRY_AGE_MS) {
        this.entries.delete(key);
      }
    }

    // If still too many, remove oldest entries
    if (this.entries.size > MAX_ENTRIES) {
      const sorted = Array.from(this.entries.entries())
        .sort((a, b) => a[1].lastOccurrence - b[1].lastOccurrence);

      const toRemove = sorted.slice(0, sorted.length - MAX_ENTRIES);
      for (const [key] of toRemove) {
        this.entries.delete(key);
      }
    }
  }

  /**
   * Record an error occurrence.
   *
   * @param componentLabel - The label of the ErrorBoundary component
   * @param errorMessage - The error message
   * @returns The updated frequency info for this error
   */
  recordError(componentLabel: string, errorMessage: string): ErrorFrequencyInfo {
    this.prune();

    const key = this.makeKey(componentLabel, errorMessage);
    const now = Date.now();
    const existing = this.entries.get(key);

    if (existing) {
      existing.count += 1;
      existing.lastOccurrence = now;
      return this.toFrequencyInfo(existing);
    }

    const entry: ErrorFrequencyEntry = {
      count: 1,
      firstOccurrence: now,
      lastOccurrence: now,
      componentLabel,
      errorMessage: errorMessage.slice(0, 200),
    };

    this.entries.set(key, entry);
    return this.toFrequencyInfo(entry);
  }

  /**
   * Get frequency info for a specific error without recording it.
   */
  getFrequency(componentLabel: string, errorMessage: string): ErrorFrequencyInfo | null {
    const key = this.makeKey(componentLabel, errorMessage);
    const entry = this.entries.get(key);
    if (!entry) return null;
    return this.toFrequencyInfo(entry);
  }

  /**
   * Get all recent errors (within the last hour).
   */
  getRecentErrors(): ErrorFrequencyEntry[] {
    const now = Date.now();
    return Array.from(this.entries.values())
      .filter((e) => now - e.lastOccurrence < MAX_ENTRY_AGE_MS)
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Clear all tracked errors.
   */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Convert an entry to frequency info.
   */
  private toFrequencyInfo(entry: ErrorFrequencyEntry): ErrorFrequencyInfo {
    const now = Date.now();
    const firstOccurrenceAgo = Math.floor((now - entry.firstOccurrence) / 1000);
    const lastOccurrenceAgo = Math.floor((now - entry.lastOccurrence) / 1000);

    return {
      count: entry.count,
      firstOccurrenceAgo,
      lastOccurrenceAgo,
      frequencyLabel: this.formatFrequency(entry.count, firstOccurrenceAgo),
    };
  }

  /**
   * Format a human-readable frequency label.
   */
  private formatFrequency(count: number, secondsAgo: number): string {
    if (count === 1) {
      return "First occurrence";
    }

    let timeWindow: string;
    if (secondsAgo < 60) {
      timeWindow = "in the last minute";
    } else if (secondsAgo < 300) {
      timeWindow = "in the last 5 minutes";
    } else if (secondsAgo < 900) {
      timeWindow = "in the last 15 minutes";
    } else if (secondsAgo < 3600) {
      timeWindow = "in the last hour";
    } else {
      timeWindow = "in this session";
    }

    return `${count} times ${timeWindow}`;
  }
}

/** Singleton instance */
export const errorFrequency = new ErrorFrequencyTracker();

/**
 * Format frequency info for display in the UI.
 */
export function formatFrequencyDisplay(info: ErrorFrequencyInfo): string {
  if (info.count <= 1) return "";
  return `⚠ This error has occurred ${info.frequencyLabel}`;
}

/**
 * Format frequency info for inclusion in a report.
 */
export function formatFrequencyForReport(info: ErrorFrequencyInfo): string {
  if (info.count <= 1) return "";

  const lines: string[] = [];
  lines.push(`**Error Frequency:** ${info.count} occurrences`);
  if (info.firstOccurrenceAgo > 0) {
    const minutes = Math.floor(info.firstOccurrenceAgo / 60);
    const seconds = info.firstOccurrenceAgo % 60;
    if (minutes > 0) {
      lines.push(`**First seen:** ${minutes}m ${seconds}s ago`);
    } else {
      lines.push(`**First seen:** ${seconds}s ago`);
    }
  }
  return lines.join("\n");
}
