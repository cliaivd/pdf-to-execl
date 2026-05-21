import * as XLSX from "xlsx";

/**
 * Convert 2D array (with optional headers) to Excel blob and trigger download.
 */
export function exportToExcel(
  columns: string[],
  rows: string[][],
  filename: string = "output.xlsx"
) {
  const wb = XLSX.utils.book_new();
  const data = columns.length > 0 ? [columns, ...rows] : rows;
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
