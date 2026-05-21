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
  const systemPrompt = `You are a precise data extraction assistant. Given an image of a document (invoice, table, form, report, etc.), extract all tabular data.

Rules:
1. Identify column headers from the document
2. Extract each data row
3. If the user specifies fields to extract (like "company name, date, amount"), match them exactly
4. Output ONLY valid JSON in this exact format, with no other text or markdown:
{"columns":["col1","col2",...],"rows":[["val1","val2",...],...]}

Keep the original language (Chinese/English etc.) of the document.`;

  const userMessage = instruction
    ? `Extract the following fields from this document: ${instruction}. Output as JSON with columns and rows.`
    : "Extract all tabular data from this document image. Output as JSON with columns and rows.";

  const response = await fetch(`${GLM_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: "glm-4v-flash",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userMessage },
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

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch =
    content.match(/```json\n?([\s\S]*?)```/) ||
    content.match(/\{[\s\S]*"columns"[\s\S]*"rows"[\s\S]*\}/);

  const jsonStr = jsonMatch
    ? (jsonMatch[1] || jsonMatch[0]).trim()
    : content.trim();

  try {
    const parsed = JSON.parse(jsonStr);
    return {
      columns: parsed.columns || [],
      rows: parsed.rows || [],
      raw: content,
    };
  } catch {
    return { columns: [], rows: [], raw: content };
  }
}
