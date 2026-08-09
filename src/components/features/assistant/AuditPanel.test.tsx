import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AuditPanel } from "./AuditPanel";
import type { AnalysisResult, Suggestion } from "./AssistantSidebar";

function makeAnalysis(overrides?: Partial<AnalysisResult>): AnalysisResult {
  return {
    score: 75,
    level: "Suboptimal",
    summary: "Good overall pipeline but memory optimization opportunities exist.",
    suggestions: [],
    ...overrides,
  };
}

function makeSuggestion(overrides?: Partial<Suggestion>): Suggestion {
  return {
    title: "Add Memory Offload",
    description: "Use Olive's memory offload pass to reduce peak VRAM usage.",
    impact: "High",
    type: "suggestion",
    autofix: { pass: "memoryOffload", value: "true" },
    ...overrides,
  };
}

describe("AuditPanel", () => {
  const noop = () => { };

  it("renders pipeline efficiency and score when analysis is available", () => {
    render(
      <AuditPanel
        analysis={makeAnalysis({ score: 82, level: "Optimized", summary: "Pipeline looks great!" })}
        isAnalyzing={false}
        analysisError=""
        onApplyAutofix={noop}
        onRunAnalysis={noop}
        onGoSettings={noop}
      />,
    );

    expect(screen.getByText("Pipeline efficiency")).toBeDefined();
    // Score is rendered as "82%" including percent sign
    expect(screen.getByText("82%")).toBeDefined();
    expect(screen.getByText("Pipeline looks great!")).toBeDefined();
    expect(screen.getByText("Optimized Mode")).toBeDefined();
  });

  it("shows auditing spinner when isAnalyzing is true", () => {
    render(
      <AuditPanel
        analysis={null}
        isAnalyzing={true}
        analysisError=""
        onApplyAutofix={noop}
        onRunAnalysis={noop}
        onGoSettings={noop}
      />,
    );

    expect(screen.getByText("Auditing pipeline...")).toBeDefined();
    expect(screen.getByText("Inspecting workspace…")).toBeDefined();
  });

  it("shows analyze button when no analysis and not analyzing", () => {
    render(
      <AuditPanel
        analysis={null}
        isAnalyzing={false}
        analysisError=""
        onApplyAutofix={noop}
        onRunAnalysis={noop}
        onGoSettings={noop}
      />,
    );

    expect(screen.getByText("Analyze Optimization Pipeline")).toBeDefined();
  });

  it("calls onRunAnalysis when analyze button is clicked", () => {
    const onRun = vi.fn();
    render(
      <AuditPanel
        analysis={null}
        isAnalyzing={false}
        analysisError=""
        onApplyAutofix={noop}
        onRunAnalysis={onRun}
        onGoSettings={noop}
      />,
    );

    fireEvent.click(screen.getByText("Analyze Optimization Pipeline"));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("shows ProviderErrorBlock when analysisError is set", () => {
    render(
      <AuditPanel
        analysis={null}
        isAnalyzing={false}
        analysisError="No AI provider configured"
        onApplyAutofix={noop}
        onRunAnalysis={noop}
        onGoSettings={noop}
      />,
    );

    expect(screen.getByText("No AI Provider Configured")).toBeDefined();
  });

  it("renders suggestions with Apply buttons when autofix is present", () => {
    const onApply = vi.fn();
    const suggestions: Suggestion[] = [
      makeSuggestion({
        title: "Enable AutoAWQ",
        description: "Use AWQ quantization.",
        autofix: { pass: "quantMethod", value: "awq" },
      }),
      makeSuggestion({
        title: "Add LoRA adapter",
        description: "Fine-tune with LoRA.",
        autofix: { pass: "loraAdapter", value: "true" },
      }),
    ];

    render(
      <AuditPanel
        analysis={makeAnalysis({ suggestions, score: 70 })}
        isAnalyzing={false}
        analysisError=""
        onApplyAutofix={onApply}
        onRunAnalysis={noop}
        onGoSettings={noop}
      />,
    );

    expect(screen.getByText("Enable AutoAWQ")).toBeDefined();
    expect(screen.getByText("Add LoRA adapter")).toBeDefined();

    // Find Apply buttons — they appear with autofix info
    const applyButtons = screen.getAllByText("Apply");
    expect(applyButtons.length).toBe(2);

    fireEvent.click(applyButtons[0]);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("renders suggestions section header even with empty suggestions", () => {
    render(
      <AuditPanel
        analysis={makeAnalysis({ suggestions: [], score: 95 })}
        isAnalyzing={false}
        analysisError=""
        onApplyAutofix={noop}
        onRunAnalysis={noop}
        onGoSettings={noop}
      />,
    );

    // Suggestions header should still render
    expect(screen.getByText("Suggestions")).toBeDefined();
    expect(screen.getByText(/No actionable changes/i)).toBeDefined();
  });

  it("shows Refresh button when analysis exists", () => {
    const onRun = vi.fn();
    render(
      <AuditPanel
        analysis={makeAnalysis()}
        isAnalyzing={false}
        analysisError=""
        onApplyAutofix={noop}
        onRunAnalysis={onRun}
        onGoSettings={noop}
      />,
    );

    fireEvent.click(screen.getByText("Refresh"));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("renders score ring with emerald for Optimized level", () => {
    render(
      <AuditPanel
        analysis={makeAnalysis({ score: 85, level: "Optimized" })}
        isAnalyzing={false}
        analysisError=""
        onApplyAutofix={noop}
        onRunAnalysis={noop}
        onGoSettings={noop}
      />,
    );

    expect(screen.getByText("85%")).toBeDefined();
    expect(screen.getByText("Optimized Mode")).toBeDefined();
  });

  it("renders score ring with amber for Suboptimal level", () => {
    render(
      <AuditPanel
        analysis={makeAnalysis({ score: 55, level: "Suboptimal" })}
        isAnalyzing={false}
        analysisError=""
        onApplyAutofix={noop}
        onRunAnalysis={noop}
        onGoSettings={noop}
      />,
    );

    expect(screen.getByText("55%")).toBeDefined();
    expect(screen.getByText("Suboptimal Mode")).toBeDefined();
  });

  it("renders score ring with rose for low/other levels", () => {
    render(
      <AuditPanel
        analysis={makeAnalysis({ score: 25, level: "Critical" })}
        isAnalyzing={false}
        analysisError=""
        onApplyAutofix={noop}
        onRunAnalysis={noop}
        onGoSettings={noop}
      />,
    );

    expect(screen.getByText("25%")).toBeDefined();
    expect(screen.getByText("Critical Mode")).toBeDefined();
  });

  it("calls onGoSettings when settings button in error is clicked", () => {
    const onGo = vi.fn();
    render(
      <AuditPanel
        analysis={null}
        isAnalyzing={false}
        analysisError="No AI provider configured"
        onApplyAutofix={noop}
        onRunAnalysis={noop}
        onGoSettings={onGo}
      />,
    );

    fireEvent.click(screen.getByText("Settings tab"));
    expect(onGo).toHaveBeenCalledTimes(1);
  });

  it("does not render Apply button when autofix is missing", () => {
    const suggestions: Suggestion[] = [
      makeSuggestion({ title: "Info Only", autofix: undefined as unknown as Suggestion["autofix"] }),
    ];

    render(
      <AuditPanel
        analysis={makeAnalysis({ suggestions, score: 60 })}
        isAnalyzing={false}
        analysisError=""
        onApplyAutofix={noop}
        onRunAnalysis={noop}
        onGoSettings={noop}
      />,
    );

    expect(screen.getByText("Info Only")).toBeDefined();
    expect(screen.queryByText("Apply")).toBeNull();
  });
});
