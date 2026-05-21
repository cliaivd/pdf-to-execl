import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy: receive base64 images from frontend, forward to DeepSeek API.
 * Keeps the API key server-side.
 */
export async function POST(request: NextRequest) {
  try {
    const { images, instruction } = await request.json();

    if (!images || !Array.isArray(images) || images.length === 0) {
      return NextResponse.json(
        { error: "No images provided" },
        { status: 400 }
      );
    }

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "DEEPSEEK_API_KEY not configured" },
        { status: 500 }
      );
    }

    const results = [];

    for (let i = 0; i < images.length; i++) {
      const result = await callDeepSeek(images[i], instruction, apiKey);
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

async function callDeepSeek(
  imageBase64: string,
  instruction: string,
  apiKey: string
) {
  const systemPrompt = `You are a precise data extraction assistant. Given an image of a document, extract all tabular data.

Rules:
1. Identify column headers from the document
2. Extract each data row
3. Output ONLY valid JSON in this exact format, no other text or markdown:
{"columns":["col1","col2",...],"rows":[["val1","val2",...],...]}

The user may provide specific extraction instructions. Follow them precisely.`;

  const response = await fetch(
    "https://api.deepseek.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  instruction ||
                  "Extract all tabular data from this document image.",
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${imageBase64}`,
                },
              },
            ],
          },
        ],
        max_tokens: 4096,
        temperature: 0.1,
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`DeepSeek API error: ${response.status} - ${err}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";

  // Try to parse JSON from response
  const jsonMatch =
    content.match(/```json\n?([\s\S]*?)```/) ||
    content.match(/\{[\s\S]*"columns"[\s\S]*"rows"[\s\S]*\}/);

  const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]).trim() : content.trim();

  try {
    const parsed = JSON.parse(jsonStr);
    return { columns: parsed.columns || [], rows: parsed.rows || [], raw: content };
  } catch {
    return { columns: [], rows: [], raw: content };
  }
}
