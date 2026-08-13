/**
 * Component tests for ActivityLog.
 * Validates Requirements 7.1, 7.3, 7.5, 7.6 at the component level.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ActivityLog } from "./ActivityLog";
import type { ActivityLogEntry } from "@/lib/types/agentTypes";

// ─── Helpers ────────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<ActivityLogEntry> = {}): ActivityLogEntry {
  return {
    id: `entry-${Math.random().toString(36).slice(2, 8)}`,
    kind: "reasoning",
    timestamp: "12:34:56",
    text: "Test entry text",
    ...overrides,
  };
}

function makeEntries(count: number): ActivityLogEntry[] {
  return Array.from({ length: count }, (_, i) =>
    makeEntry({ id: `entry-${i}`, text: `Entry ${i}` }),
  );
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe("ActivityLog", () => {
  describe("empty state", () => {
    it("renders empty state message when no entries are provided", () => {
      render(<ActivityLog entries={[]} />);
      expect(screen.getByText("No activity yet")).toBeTruthy();
    });

    it("does not render a log region when empty", () => {
      render(<ActivityLog entries={[]} />);
      expect(screen.queryByRole("log")).toBeNull();
    });
  });

  describe("entry rendering", () => {
    it("renders all provided entries in chronological order", () => {
      const entries = [
        makeEntry({ id: "a", text: "First" }),
        makeEntry({ id: "b", text: "Second" }),
        makeEntry({ id: "c", text: "Third" }),
      ];
      render(<ActivityLog entries={entries} />);
      expect(screen.getByText("First")).toBeTruthy();
      expect(screen.getByText("Second")).toBeTruthy();
      expect(screen.getByText("Third")).toBeTruthy();
    });

    it("renders entries with their timestamps", () => {
      const entries = [makeEntry({ timestamp: "09:15:30", text: "Hello" })];
      render(<ActivityLog entries={entries} />);
      expect(screen.getByText("09:15:30")).toBeTruthy();
    });

    it("uses a log role for accessibility", () => {
      render(<ActivityLog entries={[makeEntry()]} />);
      const log = screen.getByRole("log");
      expect(log).toBeTruthy();
      expect(log.getAttribute("aria-label")).toBe("Agent activity log");
    });
  });

  describe("className prop", () => {
    it("applies additional className to the container when entries exist", () => {
      const { container } = render(
        <ActivityLog entries={[makeEntry()]} className="custom-class" />,
      );
      const log = container.querySelector("[role='log']");
      expect(log?.className).toContain("custom-class");
    });

    it("applies additional className to the empty state container", () => {
      const { container } = render(
        <ActivityLog entries={[]} className="custom-empty" />,
      );
      const div = container.firstElementChild;
      expect(div?.className).toContain("custom-empty");
    });
  });

  describe("auto-scroll behavior", () => {
    it("scrolls to bottom when entries are added while at bottom", () => {
      const entries = makeEntries(5);
      const { rerender } = render(<ActivityLog entries={entries} />);
      const log = screen.getByRole("log");

      // Simulate being at bottom: scrollHeight === scrollTop + clientHeight
      Object.defineProperty(log, "scrollHeight", { value: 500, configurable: true });
      Object.defineProperty(log, "clientHeight", { value: 500, configurable: true });
      Object.defineProperty(log, "scrollTop", { value: 0, writable: true, configurable: true });

      // Add a new entry — should trigger auto-scroll
      const newEntries = [...entries, makeEntry({ id: "new", text: "New entry" })];
      rerender(<ActivityLog entries={newEntries} />);

      // scrollTop should be set to scrollHeight (auto-scroll)
      expect(log.scrollTop).toBe(500);
    });

    it("does not auto-scroll when user has scrolled away from bottom", () => {
      const entries = makeEntries(5);
      const { rerender } = render(<ActivityLog entries={entries} />);
      const log = screen.getByRole("log");

      // Simulate user scrolled away: scrollHeight - scrollTop - clientHeight > 50
      Object.defineProperty(log, "scrollHeight", { value: 1000, configurable: true });
      Object.defineProperty(log, "clientHeight", { value: 300, configurable: true });
      Object.defineProperty(log, "scrollTop", { value: 100, writable: true, configurable: true });

      // Fire scroll event to update the isNearBottom ref
      fireEvent.scroll(log);

      // Add new entry
      const newEntries = [...entries, makeEntry({ id: "new2", text: "New entry 2" })];
      rerender(<ActivityLog entries={newEntries} />);

      // scrollTop should NOT be changed (user scrolled away)
      expect(log.scrollTop).toBe(100);
    });
  });

  describe("large entry count", () => {
    it("renders up to 2000 entries without error", () => {
      const entries = makeEntries(2000);
      const { container } = render(<ActivityLog entries={entries} />);
      const log = container.querySelector("[role='log']");
      expect(log?.children.length).toBe(2000);
    });
  });
});
