import * as XLSX from "xlsx";

let workerConfigured = false;

async function ensureWorker() {
  if (workerConfigured || typeof window === "undefined") return;
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.worker.min.mjs";
  workerConfigured = true;
}

interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Extract text from PDF preserving positional info for table reconstruction.
 */
export async function extractPdfText(file: File): Promise<string> {
  await ensureWorker();
  const { getDocument } = await import("pdfjs-dist");

  const buffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: buffer }).promise;

  let fullText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    // Collect items with positions
    const items: TextItem[] = content.items.map((item: any) => ({
      str: item.str,
      x: item.transform[4],
      y: viewport.height - item.transform[5], // flip y for intuitive top→bottom
      width: item.width,
      height: item.height,
    }));

    if (items.length === 0) continue;

    // Group items by row (same Y within a tolerance)
    const tolerance = items[0].height * 0.5 || 3;
    const rows: TextItem[][] = [];
    let currentRow: TextItem[] = [items[0]];

    for (let j = 1; j < items.length; j++) {
      const prev = items[j - 1];
      const curr = items[j];
      if (Math.abs(curr.y - prev.y) < tolerance) {
        currentRow.push(curr);
      } else {
        // Sort current row by X, then add as text line
        currentRow.sort((a, b) => a.x - b.x);
        rows.push(currentRow);
        currentRow = [curr];
      }
    }
    currentRow.sort((a, b) => a.x - b.x);
    rows.push(currentRow);

    // Detect natural gaps between columns (heuristic: gap > 2x average char width)
    for (const row of rows) {
      if (row.length === 0) continue;
      const gaps: string[] = [row[0].str];
      for (let j = 1; j < row.length; j++) {
        const gap = row[j].x - (row[j - 1].x + row[j - 1].width);
        // If gap is large enough, insert tab as column separator
        // Average char width estimate
        const avgCharWidth =
          row[j - 1].width / Math.max(row[j - 1].str.length, 1);
        if (gap > avgCharWidth * 3) {
          gaps.push("\t");
        }
        gaps.push(row[j].str);
      }
      fullText += gaps.join("") + "\n";
    }
  }

  return fullText.trim();
}

/**
 * Parse text into a 2D array.
 */
export function parseTextToRows(text: string): string[][] {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Detect delimiter: tab > comma > pipe
  const tabCount = lines.reduce((s, l) => s + (l.match(/\t/g) || []).length, 0);
  const commaCount = lines.reduce(
    (s, l) => s + (l.match(/,/g) || []).length,
    0
  );
  const pipeCount = lines.reduce(
    (s, l) => s + (l.match(/\|/g) || []).length,
    0
  );

  let delimiter = "\t";
  if (commaCount > tabCount && commaCount > pipeCount) delimiter = ",";
  if (pipeCount > tabCount && pipeCount > commaCount) delimiter = "|";

  if (delimiter === "\t") {
    return lines.map((l) => l.split("\t").map((c) => c.trim()));
  }

  return lines.map((l) => l.split(delimiter).map((c) => c.trim()));
}

/**
 * Convert 2D array to Excel blob and trigger download.
 */
export function exportToExcel(
  data: string[][],
  filename: string = "output.xlsx"
) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([wbout], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
