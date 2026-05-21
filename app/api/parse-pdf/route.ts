import { NextRequest, NextResponse } from "next/server";

const GLM_API_KEY = process.env.GLM_API_KEY || "";
const GLM_BASE = "https://open.bigmodel.cn/api/paas/v4";

export async function POST(request: NextRequest) {
  try {
    const { images, instruction } = await request.json();

    if (!images || !Array.isArray(images) || images.length === 0) {
      return NextResponse.json(
        { error: "No images provided" },
        { status: 400 }
      );
    }

    if (!GLM_API_KEY) {
      return NextResponse.json(
        { error: "GLM_API_KEY not configured" },
        { status: 500 }
      );
    }

    const results = [];

    for (let i = 0; i < images.length; i++) {
      const result = await callGLM(images[i], instruction);
      results.push({ page: i + 1, ...result });
    }

    return NextResponse.json({ results });
  } catch (err: any) {
    console.error("Parse PDF error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

async function callGLM(imageBase64: string, instruction: string) {
  const prompt = instruction
    ? `You are a data extraction tool. Extract the following fields from this document image: ${instruction}

Output ONLY a markdown table. First row must be the headers. Example:
| Name | Date | Amount |
|------|------|--------|
| ABC  | 2024-01 | $100 |

No explanations, no extra text. Just the markdown table.`
    : `You are a data extraction tool. Extract ALL tabular data from this document image.

Output ONLY a markdown table. First row must be the headers. No explanations.`;

  const response = await fetch(`${GLM_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: "glm-4v-flash",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${imageBase64}` },
            },
          ],
        },
      ],
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`GLM API error: ${response.status} - ${err}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  const parsed = parseMarkdownTable(content);

  return { ...parsed, raw: content };
}

function parseMarkdownTable(text: string): {
  columns: string[];
  rows: string[][];
} {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Find the first markdown table (lines starting with |)
  const tableLines = lines.filter(
    (l) => l.startsWith("|") && l.endsWith("|")
  );

  if (tableLines.length < 2) {
    // No markdown table found; try to find any structured text
    return { columns: [], rows: [] };
  }

  // Skip separator line (|---|---|)
  const dataLines = tableLines.filter(
    (l) => !l.match(/^\|[\s\-:]+\|/)
  );

  if (dataLines.length === 0) return { columns: [], rows: [] };

  const headers = parseTableRow(dataLines[0]);

  if (headers.length === 0) return { columns: [], rows: [] };

  // If headers contain only empty/placeholder text, use generic names
  const hasRealHeaders = headers.some(
    (h) => h && h !== " " && !h.match(/^(col|column|header)/i)
  );

  const columnNames = hasRealHeaders
    ? headers
    : headers.map((_, i) => `Column ${i + 1}`);

  const rows = dataLines.slice(1).map((l) => {
    const cells = parseTableRow(l);
    // Pad or trim to match column count
    while (cells.length < columnNames.length) cells.push("");
    return cells.slice(0, columnNames.length);
  });

  return { columns: columnNames, rows };
}

function parseTableRow(line: string): string[] {
  // Remove leading/trailing pipe, split by pipe, trim each cell
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}
