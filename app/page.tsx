"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { pdfToImages } from "@/lib/pdfToImage";
import { exportToExcel } from "@/lib/excelExport";

interface PdfFile {
  name: string;
  file: File;
  size: number;
}

interface ParseResult {
  page: number;
  columns: string[];
  rows: string[][];
  raw: string;
}

type Step = "upload" | "config" | "processing" | "preview" | "done";

export default function Home() {
  const [files, setFiles] = useState<PdfFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [step, setStep] = useState<Step>("upload");
  const [instruction, setInstruction] = useState(
    "Extract all table data from this document, including headers. Output as markdown table."
  );
  const [editingInstruction, setEditingInstruction] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [results, setResults] = useState<ParseResult[]>([]);
  const [editingColumns, setEditingColumns] = useState<string[]>([]);
  const [editingRows, setEditingRows] = useState<string[][]>([]);
  const [editingCell, setEditingCell] = useState<{ r: number; c: number } | null>(null);
  const [error, setError] = useState("");
  const [rawModeText, setRawModeText] = useState("");

  const addFiles = useCallback((fileList: FileList | File[]) => {
    const pdfs = Array.from(fileList).filter(
      (f) => f.type === "application/pdf" || f.name.endsWith(".pdf")
    );
    setFiles((prev) => [
      ...prev,
      ...pdfs.map((f) => ({ name: f.name, file: f, size: f.size })),
    ]);
    setError("");
    setStep("upload");
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  const handleClick = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,application/pdf";
    input.multiple = true;
    input.onchange = () => {
      if (input.files) addFiles(input.files);
    };
    input.click();
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleStartParse = async () => {
    if (files.length === 0) return;
    setStep("processing");
    setError("");
    setResults([]);

    try {
      const allResults: ParseResult[] = [];

      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        setStatusText(`Converting: ${f.name}`);
        setProgress(Math.round((i / files.length) * 100));

        const { pages } = await pdfToImages(f.file);

        setStatusText(`AI analyzing: ${f.name}`);
        setProgress(Math.round(((i + 0.5) / files.length) * 100));

        const res = await fetch("/api/parse-pdf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            images: pages,
            instruction: instruction || "Extract all tabular data",
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "API error");
        }

        const data = await res.json();
        allResults.push(...data.results);
      }

      setResults(allResults);

      // Process results: use first file's structure
      const cols = allResults[0]?.columns || [];
      const rows = allResults.flatMap((r) => r.rows || []);

      if (cols.length > 0) {
        setEditingColumns(cols);
        setEditingRows(rows);
        setProgress(100);
        setStatusText("Done!");
        setStep("preview");
      } else {
        // No structured data — show raw text
        setRawModeText(allResults.map((r) => r.raw).join("\n\n---\n\n"));
        setProgress(100);
        setStatusText("Done!");
        setStep("preview");
      }
    } catch (err: any) {
      setError(err?.message || "Something went wrong");
      setStep("config");
    }
  };

  // Handle raw text → table conversion
  const applyRawText = () => {
    const rows = rawModeText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("---"));

    if (rows.length === 0) return;

    // Try to split by common delimiters
    const hasPipe = rows.some((r) => r.startsWith("|"));
    const hasTab = rows.some((r) => r.includes("\t"));
    const hasComma = rows.some((r) => r.includes(","));

    let parsed: string[][];

    if (hasPipe) {
      parsed = rows
        .filter((l) => l.startsWith("|"))
        .filter((l) => !l.match(/^\|[\s\-:]+\|$/)) // skip separator
        .map((l) =>
          l
            .replace(/^\|/, "")
            .replace(/\|$/, "")
            .split("|")
            .map((c) => c.trim())
        );
    } else if (hasTab) {
      parsed = rows.map((l) => l.split("\t").map((c) => c.trim()));
    } else if (hasComma) {
      parsed = rows.map((l) => l.split(",").map((c) => c.trim()));
    } else {
      // Single column
      parsed = rows.map((l) => [l]);
    }

    if (parsed.length > 0) {
      // Max column count determines structure
      const maxCols = Math.max(...parsed.map((r) => r.length));
      const normalized = parsed.map((r) => {
        while (r.length < maxCols) r.push("");
        return r.slice(0, maxCols);
      });
      setEditingColumns(normalized[0]);
      setEditingRows(normalized.slice(1));
    }
  };

  const handleExport = () => {
    const name =
      files.length === 1
        ? files[0].name.replace(/\.pdf$/i, "") + ".xlsx"
        : "combined.xlsx";
    exportToExcel(editingColumns, editingRows, name);
    setStep("done");
  };

  const updateCell = (r: number, c: number, value: string) => {
    setEditingRows((prev) => {
      const next = prev.map((row) => [...row]);
      next[r][c] = value;
      return next;
    });
  };

  const addRow = () => {
    const cols = editingColumns.length || 1;
    setEditingRows((prev) => [...prev, Array(cols).fill("")]);
  };

  const removeRow = (r: number) => {
    setEditingRows((prev) => prev.filter((_, i) => i !== r));
  };

  const addColumn = () => {
    setEditingColumns((prev) => [...prev, `Col ${prev.length + 1}`]);
    setEditingRows((prev) => prev.map((row) => [...row, ""]));
  };

  const removeColumn = (c: number) => {
    setEditingColumns((prev) => prev.filter((_, i) => i !== c));
    setEditingRows((prev) => prev.map((row) => row.filter((_, i) => i !== c)));
  };

  const updateColumnName = (c: number, name: string) => {
    setEditingColumns((prev) => {
      const next = [...prev];
      next[c] = name;
      return next;
    });
  };

  const reset = () => {
    setFiles([]);
    setStep("upload");
    setProgress(0);
    setResults([]);
    setEditingColumns([]);
    setEditingRows([]);
    setError("");
    setRawModeText("");
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <main className="flex min-h-screen flex-col items-center bg-gray-50 p-4">
      <div className="w-full max-w-5xl">
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-800">PDF → Excel</h1>
          <p className="mt-1 text-sm text-gray-500">
            Upload PDF &rarr; AI extracts data &rarr; Edit &rarr; Export Excel
          </p>
        </header>

        {/* Step 1: Upload */}
        {(step === "upload" || step === "config") && (
          <>
            <div
              onDrop={handleDrop}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragging(false);
              }}
              onClick={handleClick}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 transition-colors ${
                dragging
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-300 bg-white hover:border-gray-400 hover:bg-gray-50"
              }`}
            >
              <svg
                className="mb-4 h-12 w-12 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
              <p className="text-base text-gray-500">
                <span className="font-medium text-blue-600">Click to upload</span>{" "}
                or drag and drop
              </p>
              <p className="mt-1 text-sm text-gray-400">PDF files only</p>
            </div>

            {files.length > 0 && (
              <ul className="mt-6 space-y-2">
                {files.map((file, i) => (
                  <li
                    key={`${file.name}-${i}`}
                    className="flex items-center justify-between rounded-lg bg-white px-4 py-3 shadow-sm"
                  >
                    <div className="flex items-center gap-3 truncate">
                      <svg
                        className="h-5 w-5 shrink-0 text-red-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                        />
                      </svg>
                      <span className="truncate text-sm text-gray-700">
                        {file.name}
                      </span>
                      <span className="shrink-0 text-xs text-gray-400">
                        {formatSize(file.size)}
                      </span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFile(i);
                      }}
                      className="ml-2 shrink-0 text-gray-400 hover:text-red-500"
                      aria-label="Remove file"
                    >
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {/* Step 2: Configure */}
        {(step === "config" || (files.length > 0 && step === "upload")) &&
          files.length > 0 && (
            <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-gray-700">
                Tell AI what to extract
              </h2>

              {editingInstruction ? (
                <textarea
                  autoFocus
                  className="w-full rounded-lg border border-gray-300 p-3 text-sm"
                  rows={4}
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  onBlur={() => setEditingInstruction(false)}
                />
              ) : (
                <div
                  className="cursor-pointer rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600 hover:border-gray-300"
                  onClick={() => setEditingInstruction(true)}
                >
                  {instruction || "Click to enter instructions..."}
                  <svg
                    className="ml-2 inline-block h-3 w-3 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                    />
                  </svg>
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => setInstruction("")}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50"
                >
                  Clear
                </button>
                <button
                  onClick={() =>
                    setInstruction(
                      "Extract invoice fields: company name, invoice date, invoice number, total amount (tax included), tax amount, buyer name"
                    )
                  }
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50"
                >
                  Invoice
                </button>
                <button
                  onClick={() =>
                    setInstruction(
                      "Extract all table data with headers from this document. Output as markdown table."
                    )
                  }
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50"
                >
                  Generic table
                </button>
                <button
                  onClick={() => setStep("config")}
                  className="ml-auto rounded-lg bg-blue-600 px-6 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Next: Configure
                </button>
              </div>
            </div>
          )}

        {step === "config" && (
          <div className="mt-4 text-center">
            <button
              onClick={handleStartParse}
              className="rounded-lg bg-blue-600 px-8 py-3 text-base font-semibold text-white shadow hover:bg-blue-700"
            >
              Start AI Extraction
            </button>
          </div>
        )}

        {/* Step 3: Processing */}
        {step === "processing" && (
          <div className="flex flex-col items-center justify-center rounded-xl bg-white p-12 shadow-sm">
            <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
            <p className="text-sm text-gray-600">{statusText}</p>
            <div className="mt-4 h-2 w-64 overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-blue-600 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-gray-400">{progress}%</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {/* Step 4a: Preview with structured table */}
        {(step === "preview" || step === "done") && editingColumns.length > 0 && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-800">
                Preview & Edit
              </h2>
              <div className="flex flex-wrap gap-2">
                <button onClick={addRow} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">+ Row</button>
                <button onClick={addColumn} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">+ Column</button>
                <button onClick={handleExport} className="rounded-lg bg-green-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-green-700">
                  {step === "done" ? "✅ Exported" : "Export to Excel"}
                </button>
                <button onClick={reset} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">Start Over</button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead>
                  <tr>
                    <th className="w-8 px-1 py-2"></th>
                    {editingColumns.map((col, c) => (
                      <th key={c} className="relative px-3 py-2 text-left font-medium text-gray-500">
                        <div className="flex items-center gap-1">
                          {editingCell?.r === -1 && editingCell?.c === c ? (
                            <input autoFocus className="w-24 border border-blue-400 px-1 text-sm" value={col} onChange={(e) => updateColumnName(c, e.target.value)} onBlur={() => setEditingCell(null)} onKeyDown={(e) => { if (e.key === "Escape" || e.key === "Enter") setEditingCell(null); }} />
                          ) : (
                            <span className="cursor-pointer text-xs text-gray-500 hover:text-blue-600" onClick={() => setEditingCell({ r: -1, c })}>{col}</span>
                          )}
                          <button onClick={() => removeColumn(c)} className="text-gray-300 hover:text-red-500" aria-label="Remove column">
                            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {editingRows.map((row, r) => (
                    <tr key={r} className="hover:bg-gray-50">
                      <td className="px-1 py-1">
                        <button onClick={() => removeRow(r)} className="text-gray-300 hover:text-red-500" aria-label="Remove row">
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </td>
                      {row.map((cell, c) => (
                        <td key={c} className={`cursor-pointer px-3 py-2 ${editingCell?.r === r && editingCell?.c === c ? "p-0" : ""}`} onClick={() => setEditingCell({ r, c })}>
                          {editingCell?.r === r && editingCell?.c === c ? (
                            <textarea autoFocus className="w-full resize-none border-2 border-blue-400 bg-white px-2 py-1 text-sm outline-none" rows={Math.max(2, cell.split("\n").length)} value={cell} onChange={(e) => updateCell(r, c, e.target.value)} onBlur={() => setEditingCell(null)} onKeyDown={(e) => { if (e.key === "Escape") setEditingCell(null); }} />
                          ) : (
                            <span className="whitespace-pre-wrap text-gray-700">{cell || <span className="text-gray-300">&mdash;</span>}</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-gray-400">Rows: {editingRows.length} · Columns: {editingColumns.length} · Click cell to edit · Esc to cancel</p>
          </div>
        )}

        {/* Step 4b: Raw text fallback */}
        {(step === "preview" || step === "done") &&
          editingColumns.length === 0 &&
          results.length > 0 && (
            <div className="mt-6 rounded-xl border border-yellow-200 bg-yellow-50 p-6">
              <h3 className="mb-2 text-sm font-semibold text-yellow-800">
                AI Response Received — Not Auto-Formatted
              </h3>
              <p className="mb-3 text-xs text-yellow-600">
                The AI returned text instead of a structured table. You can either edit the text below and click &quot;Apply as Table&quot;, or go back and refine your instructions.
              </p>

              <textarea
                className="w-full rounded-lg border border-gray-300 p-3 text-xs font-mono"
                rows={12}
                value={rawModeText}
                onChange={(e) => setRawModeText(e.target.value)}
              />

              <div className="mt-3 flex gap-2">
                <button
                  onClick={applyRawText}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Apply as Table
                </button>
                <button
                  onClick={reset}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
                >
                  Start Over
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-400">
                Tip: Use | pipes or paste comma/tab-separated data. First row becomes column headers.
              </p>
            </div>
          )}
      </div>
    </main>
  );
}
