import { NextRequest, NextResponse } from "next/server";

const DASHSCOPE_KEY = process.env.DASHSCOPE_API_KEY || "";
const DASHSCOPE_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1";

export async function POST(request: NextRequest) {
  try {
    const { images, instruction } = await request.json();

    if (!images || !Array.isArray(images) || images.length === 0) {
      return NextResponse.json(
        { error: "No images provided" },
        { status: 400 }
      );
    }

    if (!DASHSCOPE_KEY) {
      return NextResponse.json(
        { error: "DASHSCOPE_API_KEY not configured" },
        { status: 500 }
      );
    }

    const results = [];

    for (let i = 0; i < images.length; i++) {
      const result = await callQwenVL(images[i], instruction);
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

async function callQwenVL(imageBase64: string, instruction: string) {
  const prompt = instruction
    ? `Extract the following fields from this document image: ${instruction}

You MUST output ONLY a valid JSON object with two keys: "columns" (array of column names) and "rows" (array of arrays of cell values).
No markdown, no code blocks, no explanations. ONLY the JSON.

Example for an invoice: {"columns":["company","date","amount"],"rows":[["ABC Corp","2024-01-15","$100"]]}

If no data is found, return: {"columns":[],"rows":[]}`
    : `Extract ALL tabular data from this document image.

You MUST output ONLY a valid JSON object with two keys: "columns" and "rows".
No markdown, no code blocks, no explanations. ONLY the JSON.

If no data is found, return: {"columns":[],"rows":[]}`;

  const response = await fetch(`${DASHSCOPE_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DASHSCOPE_KEY}`,
    },
    body: JSON.stringify({
      model: "qwen-vl-plus",
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
      temperature: 0.01,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Qwen-VL API error: ${response.status} - ${err}`);
  }

  const data = await response.json();
  let content = data.choices?.[0]?.message?.content || "";

  // Aggressive JSON extraction
  // 1. Try full content as JSON
  try {
    const parsed = JSON.parse(content.trim());
    if (parsed.columns !== undefined) {
      return { columns: parsed.columns || [], rows: parsed.rows || [], raw: content };
    }
  } catch {}

  // 2. Markdown code block
  const blockMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (blockMatch) {
    try {
      const parsed = JSON.parse(blockMatch[1].trim());
      return { columns: parsed.columns || [], rows: parsed.rows || [], raw: content };
    } catch {}
  }

  // 3. Any JSON with columns
  const jsonMatch = content.match(/\{[\s\S]*?"columns"[\s\S]*?"rows"[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return { columns: parsed.columns || [], rows: parsed.rows || [], raw: content };
    } catch {}
  }

  return { columns: [], rows: [], raw: content };
}
