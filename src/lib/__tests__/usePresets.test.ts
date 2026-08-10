// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useImportPresets } from "@/lib/hooks/usePresets";

type Preset = { name: string };

describe("useImportPresets", () => {
  let fileReaders: FakeFileReader[];

  class FakeFileReader {
    result: string | null = null;
    error: DOMException | null = null;
    onload: ((ev: ProgressEvent<FileReader>) => void) | null = null;
    onerror: ((ev: ProgressEvent<FileReader>) => void) | null = null;

    constructor() {
      fileReaders.push(this);
    }

    readAsText(_file: Blob) {
      // Tests drive onload/onerror explicitly.
    }
  }

  beforeEach(() => {
    fileReaders = [];
    vi.stubGlobal("FileReader", FakeFileReader);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("clears a prior error when a later import succeeds", async () => {
    const setError = vi.fn();
    const parseImport = vi
      .fn()
      .mockReturnValueOnce({ ok: false as const, error: "bad json" })
      .mockReturnValueOnce({
        ok: true as const,
        presets: [{ name: "a" }],
        importedPresets: [{ name: "a" }],
        collisions: [],
      });

    const { result } = renderHook(() =>
      useImportPresets<Preset>({
        customPresets: [],
        setError,
        parseImport,
      }),
    );

    const createElementSpy = vi.spyOn(document, "createElement");

    await act(async () => {
      result.current.handleImport();
    });
    const input1 = createElementSpy.mock.results.at(-1)?.value as HTMLInputElement;
    Object.defineProperty(input1, "files", {
      configurable: true,
      value: [new File(["{bad"], "bad.json", { type: "application/json" })],
    });
    await act(async () => {
      input1.onchange?.({ target: input1 } as unknown as Event);
    });
    await act(async () => {
      const reader = fileReaders[0];
      reader.result = "{bad";
      reader.onload?.({ target: reader } as ProgressEvent<FileReader>);
    });
    expect(setError).toHaveBeenCalledWith("bad json");
    expect(result.current.importConfirm).toBeNull();

    await act(async () => {
      result.current.handleImport();
    });
    const input2 = createElementSpy.mock.results.at(-1)?.value as HTMLInputElement;
    Object.defineProperty(input2, "files", {
      configurable: true,
      value: [new File(['[{"name":"a"}]'], "good.json", { type: "application/json" })],
    });
    await act(async () => {
      input2.onchange?.({ target: input2 } as unknown as Event);
    });
    await act(async () => {
      const reader = fileReaders[1];
      reader.result = '[{"name":"a"}]';
      reader.onload?.({ target: reader } as ProgressEvent<FileReader>);
    });

    expect(setError).toHaveBeenLastCalledWith("");
    expect(result.current.importConfirm).toEqual({
      importedPresets: [{ name: "a" }],
      collisions: [],
      mergedPresets: [{ name: "a" }],
    });
  });

  it("clears stale confirmation when a later read fails", async () => {
    const setError = vi.fn();
    const parseImport = vi.fn().mockReturnValue({
      ok: true as const,
      presets: [{ name: "a" }],
      importedPresets: [{ name: "a" }],
      collisions: [],
    });

    const { result } = renderHook(() =>
      useImportPresets<Preset>({
        customPresets: [],
        setError,
        parseImport,
      }),
    );

    const createElementSpy = vi.spyOn(document, "createElement");

    await act(async () => {
      result.current.handleImport();
    });
    const input1 = createElementSpy.mock.results.at(-1)?.value as HTMLInputElement;
    Object.defineProperty(input1, "files", {
      configurable: true,
      value: [new File(['[{"name":"a"}]'], "good.json", { type: "application/json" })],
    });
    await act(async () => {
      input1.onchange?.({ target: input1 } as unknown as Event);
    });
    await act(async () => {
      const reader = fileReaders[0];
      reader.result = '[{"name":"a"}]';
      reader.onload?.({ target: reader } as ProgressEvent<FileReader>);
    });
    expect(result.current.importConfirm).not.toBeNull();

    await act(async () => {
      result.current.handleImport();
    });
    const input2 = createElementSpy.mock.results.at(-1)?.value as HTMLInputElement;
    Object.defineProperty(input2, "files", {
      configurable: true,
      value: [new File(["x"], "unreadable.json", { type: "application/json" })],
    });
    await act(async () => {
      input2.onchange?.({ target: input2 } as unknown as Event);
    });
    await act(async () => {
      const reader = fileReaders[1];
      reader.error = new DOMException("NotReadableError");
      reader.onerror?.({ target: reader } as ProgressEvent<FileReader>);
    });

    expect(result.current.importConfirm).toBeNull();
    expect(setError).toHaveBeenLastCalledWith("Failed to read file: NotReadableError");
  });

  it("clears confirmation when a later parse fails after a successful import", async () => {
    const setError = vi.fn();
    const parseImport = vi
      .fn()
      .mockReturnValueOnce({
        ok: true as const,
        presets: [{ name: "a" }],
        importedPresets: [{ name: "a" }],
        collisions: [],
      })
      .mockReturnValueOnce({ ok: false as const, error: "bad json" });

    const { result } = renderHook(() =>
      useImportPresets<Preset>({
        customPresets: [],
        setError,
        parseImport,
      }),
    );

    const createElementSpy = vi.spyOn(document, "createElement");

    await act(async () => {
      result.current.handleImport();
    });
    const input1 = createElementSpy.mock.results.at(-1)?.value as HTMLInputElement;
    Object.defineProperty(input1, "files", {
      configurable: true,
      value: [new File(['[{"name":"a"}]'], "good.json", { type: "application/json" })],
    });
    await act(async () => {
      input1.onchange?.({ target: input1 } as unknown as Event);
    });
    await act(async () => {
      const reader = fileReaders[0];
      reader.result = '[{"name":"a"}]';
      reader.onload?.({ target: reader } as ProgressEvent<FileReader>);
    });
    expect(result.current.importConfirm).not.toBeNull();

    await act(async () => {
      result.current.handleImport();
    });
    const input2 = createElementSpy.mock.results.at(-1)?.value as HTMLInputElement;
    Object.defineProperty(input2, "files", {
      configurable: true,
      value: [new File(["{bad"], "bad.json", { type: "application/json" })],
    });
    await act(async () => {
      input2.onchange?.({ target: input2 } as unknown as Event);
    });
    await act(async () => {
      const reader = fileReaders[1];
      reader.result = "{bad";
      reader.onload?.({ target: reader } as ProgressEvent<FileReader>);
    });

    expect(result.current.importConfirm).toBeNull();
    expect(setError).toHaveBeenLastCalledWith("bad json");
  });

  it("ignores an obsolete reader error after a newer import succeeds", async () => {
    const setError = vi.fn();
    const parseImport = vi.fn().mockReturnValue({
      ok: true as const,
      presets: [{ name: "newer" }],
      importedPresets: [{ name: "newer" }],
      collisions: [],
    });

    const { result } = renderHook(() =>
      useImportPresets<Preset>({
        customPresets: [],
        setError,
        parseImport,
      }),
    );

    const createElementSpy = vi.spyOn(document, "createElement");

    await act(async () => {
      result.current.handleImport();
    });
    const input1 = createElementSpy.mock.results.at(-1)?.value as HTMLInputElement;
    Object.defineProperty(input1, "files", {
      configurable: true,
      value: [new File(["old"], "old.json", { type: "application/json" })],
    });
    await act(async () => {
      input1.onchange?.({ target: input1 } as unknown as Event);
    });

    await act(async () => {
      result.current.handleImport();
    });
    const input2 = createElementSpy.mock.results.at(-1)?.value as HTMLInputElement;
    Object.defineProperty(input2, "files", {
      configurable: true,
      value: [new File(['[{"name":"newer"}]'], "newer.json", { type: "application/json" })],
    });
    await act(async () => {
      input2.onchange?.({ target: input2 } as unknown as Event);
    });
    await act(async () => {
      const newer = fileReaders[1];
      newer.result = '[{"name":"newer"}]';
      newer.onload?.({ target: newer } as ProgressEvent<FileReader>);
    });
    expect(result.current.importConfirm).toEqual({
      importedPresets: [{ name: "newer" }],
      collisions: [],
      mergedPresets: [{ name: "newer" }],
    });

    await act(async () => {
      const older = fileReaders[0];
      older.error = new DOMException("NotReadableError");
      older.onerror?.({ target: older } as ProgressEvent<FileReader>);
    });

    expect(result.current.importConfirm).toEqual({
      importedPresets: [{ name: "newer" }],
      collisions: [],
      mergedPresets: [{ name: "newer" }],
    });
    expect(setError).not.toHaveBeenCalledWith("Failed to read file: NotReadableError");
  });
});
