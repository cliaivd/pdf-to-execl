"use client";

import { useCallback, useState, useRef } from "react";
import { extractPdfText, parseTextToRows, exportToExcel } from "@/lib/pdfParser";

interface PdfFile {
  name: string;
  size: number;
  file: File;
}

type Step = "upload" | "processing" | "preview" | "done";

export default function Home() {
  const [files, setFiles] = useState<PdfFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [step, setStep] = useState<Step>("upload");
  const [currentFile, setCurrentFile] = useState<string>("");
  const [progress, setProgress] = useState(0);
  const [tableData, setTableData] = useState<string[][]>([]);
  const [editingData, setEditingData] = useState<string[][]>([]);
  const [editingCell, setEditingCell] = useState<{ r: number; c: number } | null>(null);
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const addFiles = useCallback((fileList: FileList | File[]) => {
    const pdfs = Array.from(fileList).filter(
      (f) => f.type === "application/pdf" || f.name.endsWith(".pdf")
    );
    setFiles((prev) => [
      ...prev,
      ...pdfs.map((f) => ({ name: f.name, size: f.size, file: f })),
    ]);
    setError("");
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

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

  const handleProcess = async () => {
    if (files.length === 0) return;
    setStep("processing");
    setError("");

    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        setCurrentFile(f.name);
        setProgress(Math.round(((i) / files.length) * 100));

        const text = await extractPdfText(f.file);
        const rows = parseTextToRows(text);

        if (i === 0) {
          setTableData(rows);
          setEditingData(rows.map((r) => [...r]));
        } else {
          // For multiple files, keep appending
          setTableData((prev) => [...prev, ...rows]);
          setEditingData((prev) => [...prev, ...rows.map((r) => [...r])]);
        }

        setProgress(Math.round(((i + 1) / files.length) * 100));
      }
      setStep("preview");
    } catch (err: any) {
      setError(err?.message || "Failed to parse PDF");
      setStep("upload");
    }
  };

  const handleExport = () => {
    const name =
      files.length === 1
        ? files[0].name.replace(/\.pdf$/i, "") + ".xlsx"
        : "combined.xlsx";
    exportToExcel(editingData, name);
    setStep("done");
  };

  const updateCell = (r: number, c: number, value: string) => {
    setEditingData((prev) => {
      const next = prev.map((row) => [...row]);
      next[r][c] = value;
      return next;
    });
  };

  const addRow = () => {
    const cols = editingData[0]?.length || 1;
    setEditingData((prev) => [...prev, Array(cols).fill("")]);
  };

  const removeRow = (r: number) => {
    setEditingData((prev) => prev.filter((_, i) => i !== r));
  };

  const addColumn = () => {
    setEditingData((prev) => prev.map((row) => [...row, ""]));
  };

  const removeColumn = (c: number) => {
    setEditingData((prev) => prev.map((row) => row.filter((_, i) => i !== c)));
  };

  const reset = () => {
    setFiles([]);
    setStep("upload");
    setCurrentFile("");
    setProgress(0);
    setTableData([]);
    setEditingData([]);
    setError("");
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <main className="flex min-h-screen flex-col items-center bg-gray-50 p-4">
      <div className="w-full max-w-4xl">
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-800">PDF → Excel</h1>
          <p className="mt-1 text-sm text-gray-500">
            Upload PDFs, extract tables, edit, and export to Excel
          </p>
        </header>

        {step === "upload" && (
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
              <>
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

                <button
                  onClick={handleProcess}
                  className="mt-6 w-full rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow transition hover:bg-blue-700"
                >
                  Process {files.length} file{files.length > 1 ? "s" : ""}
                </button>
              </>
            )}

            {error && (
              <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            )}
          </>
        )}

        {step === "processing" && (
          <div className="flex flex-col items-center justify-center rounded-xl bg-white p-12 shadow-sm">
            <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
            <p className="text-sm text-gray-600">
              Processing: {currentFile}
            </p>
            <div className="mt-4 h-2 w-64 overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-blue-600 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-gray-400">{progress}%</p>
          </div>
        )}

        {(step === "preview" || step === "done") && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-800">
                Preview & Edit
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={addRow}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                >
                  + Row
                </button>
                <button
                  onClick={addColumn}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                >
                  + Column
                </button>
                <button
                  onClick={handleExport}
                  className="rounded-lg bg-green-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-green-700"
                >
                  {step === "done" ? "✅ Exported" : "Export to Excel"}
                </button>
                <button
                  onClick={reset}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                >
                  Start Over
                </button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead>
                  <tr>
                    <th className="w-8 px-1 py-2"></th>
                    {editingData[0]?.map((_, c) => (
                      <th
                        key={c}
                        className="relative px-3 py-2 text-left font-medium text-gray-500"
                      >
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-gray-400">
                            Col {c + 1}
                          </span>
                          <button
                            onClick={() => removeColumn(c)}
                            className="text-gray-300 hover:text-red-500"
                            aria-label="Remove column"
                          >
                            <svg
                              className="h-3 w-3"
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
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {editingData.map((row, r) => (
                    <tr key={r} className="hover:bg-gray-50">
                      <td className="px-1 py-1">
                        <button
                          onClick={() => removeRow(r)}
                          className="text-gray-300 hover:text-red-500"
                          aria-label="Remove row"
                        >
                          <svg
                            className="h-3.5 w-3.5"
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
                      </td>
                      {row.map((cell, c) => (
                        <td
                          key={c}
                          className={`cursor-pointer px-3 py-2 ${
                            editingCell?.r === r && editingCell?.c === c
                              ? "p-0"
                              : ""
                          }`}
                          onClick={() => setEditingCell({ r, c })}
                        >
                          {editingCell?.r === r && editingCell?.c === c ? (
                            <textarea
                              ref={textareaRef}
                              autoFocus
                              className="w-full resize-none border-2 border-blue-400 bg-white px-2 py-1 text-sm outline-none"
                              rows={Math.max(2, cell.split("\n").length)}
                              value={cell}
                              onChange={(e) =>
                                updateCell(r, c, e.target.value)
                              }
                              onBlur={() => setEditingCell(null)}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") setEditingCell(null);
                              }}
                            />
                          ) : (
                            <span className="whitespace-pre-wrap text-gray-700">
                              {cell || <span className="text-gray-300">—</span>}
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-3 text-xs text-gray-400">
              Rows: {editingData.length} · Columns:{" "}
              {editingData[0]?.length || 0}
              {" · "}
              Click a cell to edit · Esc to cancel
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
