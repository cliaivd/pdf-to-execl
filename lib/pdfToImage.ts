/**
 * Convert PDF pages to base64 PNG images in the browser.
 * Uses pdfjs-dist to render each page to canvas.
 */
let workerConfigured = false;

async function ensureWorker() {
  if (workerConfigured || typeof window === "undefined") return;
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.worker.min.mjs";
  workerConfigured = true;
}

export async function pdfToImages(
  file: File
): Promise<{ pages: string[]; numPages: number }> {
  await ensureWorker();
  const { getDocument } = await import("pdfjs-dist");

  const buffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: buffer }).promise;

  const scale = 2; // 2x for better OCR quality
  const pages: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;

    await page.render({ canvas: canvas, canvasContext: ctx, viewport }).promise;
    const base64 = canvas.toDataURL("image/png").split(",")[1];
    pages.push(base64);
  }

  return { pages, numPages: pdf.numPages };
}
