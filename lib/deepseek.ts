const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_BASE = "https://api.deepseek.com/v1";

export interface ParseResult {
  columns: string[];
  rows: string[][];
  raw: string;
}

/**
 * Send PDF page image to DeepSeek Vision and ask it to extract structured data.
 * The image is a base64-encoded PNG.
 */
export async function parsePdfPageWithAI(
  imageBase64: string,
  instruction: string
): Promise<ParseResult> {
  const response = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        {
          role: "system",
          content: `You are a data extraction assistant. Given an image of a document (invoice, table, form, etc.), extract all tabular data.

Rules:
1. Identify the columns/headers from the document
2. Extract each row of data
3. Output ONLY valid JSON in this exact format, no other text:
{"columns":["col1","col2",...],"rows":[["val1","val2",...],...]}

The user may provide specific extraction instructions. Follow them precisely.`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: instruction || "Extract all tabular data from this document.",
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
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`DeepSeek API error: ${response.status} - ${err}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = content.match(/```json\n?([\s\S]*?)```/) ||
    content.match(/\{[\s\S]*"columns"[\s\S]*"rows"[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : content;

  try {
    const parsed = JSON.parse(jsonStr.trim());
    return {
      columns: parsed.columns || [],
      rows: parsed.rows || [],
      raw: content,
    };
  } catch {
    // If JSON parsing fails, return raw text for manual editing
    return {
      columns: [],
      rows: [],
      raw: content,
    };
  }
}
