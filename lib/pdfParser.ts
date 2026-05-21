import * as XLSX from "xlsx";

let workerConfigured = false;

async function ensureWorker() {
  if (workerConfigured || typeof window === "undefined") return;
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.worker.min.mjs";
  workerConfigured = true;
}

/**
 * Extract text content from PDF using pdfjs-dist.
 * Run in browser context only.
 */
export async function extractPdfText(file: File): Promise<string> {
  await ensureWorker();
  const { getDocument } = await import("pdfjs-dist");

  const buffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: buffer }).promise;

  let fullText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item: any) => item.str)
      .join(" ");
    fullText += pageText + "\n\n";
  }

  return fullText.trim();
}

/**
 * Parse text into a 2D array, splitting on newlines and tabs/commas.
 * Auto-detects delimiter.
 */
export function parseTextToRows(text: string): string[][] {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Heuristic: detect delimiter by counting occurrences
  const tabCount = lines.reduce((s, l) => s + (l.match(/\t/g) || []).length, 0);
  const commaCount = lines.reduce(
    (s, l) => s + (l.match(/,/g) || []).length,
    0
  );
  const pipeCount = lines.reduce((s, l) => s + (l.match(/\|/g) || []).length, 0);

  let delimiter: string = "\t";
  if (commaCount > tabCount && commaCount > pipeCount) delimiter = ",";
  if (pipeCount > tabCount && pipeCount > commaCount) delimiter = "|";
  // Default to splitting by whitespace if no clear delimiter
  const totalDelim = tabCount + commaCount + pipeCount;
  if (totalDelim < lines.length * 0.5) {
    // Likely space-separated or plain block text — split by 2+ spaces or single space
    return lines.map((l) =>
      l.split(/\s{2,}|\t/).map((c) => c.trim())
    );
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
