import { NextRequest, NextResponse } from "next/server";

const DASHSCOPE_KEY = process.env.DASHSCOPE_API_KEY || "";
const API_BASE = "https://dashscope.aliyuncs.com/api/v1";

const ASSISTANT_ID = "asst_e49f9ada-8dc3-4500-be79-0b81da22bb50";

async function callAssistant(imageBase64: string, instruction: string) {
  // 1. Create a thread
  const threadRes = await fetch(`${API_BASE}/threads`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DASHSCOPE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  const thread = await threadRes.json();
  const threadId = thread.id;
  if (!threadId) throw new Error("Failed to create thread: " + JSON.stringify(thread));

  // 2. Add message with image
  const prompt = instruction
    ? `Extract the following fields from this document image: ${instruction}

Output ONLY valid JSON with "columns" (array of field names) and "rows" (array of arrays of cell values).
Example: {"columns":["company","date","amount"],"rows":[["ABC Corp","2024-01","100.00"]]}
No markdown, no extra text. Only the JSON object.`
    : `Extract ALL tabular data from this document image.

Output ONLY valid JSON with "columns" and "rows".
No markdown, no extra text. Only the JSON object.`;

  const msgRes = await fetch(`${API_BASE}/threads/${threadId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DASHSCOPE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      role: "user",
      content: [
        { type: "text", text: prompt },
        {
          type: "image_url",
          image_url: { url: `data:image/png;base64,${imageBase64}` },
        },
      ],
    }),
  });
  await msgRes.json();

  // 3. Run the assistant
  const runRes = await fetch(`${API_BASE}/threads/${threadId}/runs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DASHSCOPE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ assistant_id: ASSISTANT_ID }),
  });
  const run = await runRes.json();
  const runId = run.id;

  // 4. Poll until completed
  let status = "in_progress";
  let attempts = 0;
  while (status === "in_progress" || status === "queued") {
    await new Promise((r) => setTimeout(r, 1000));
    const pollRes = await fetch(
      `${API_BASE}/threads/${threadId}/runs/${runId}`,
      {
        headers: { Authorization: `Bearer ${DASHSCOPE_KEY}` },
      }
    );
    const poll = await pollRes.json();
    status = poll.status;
    attempts++;
    if (attempts > 60) break; // 60s timeout
  }

  if (status !== "completed") {
    throw new Error(`Assistant run failed with status: ${status}`);
  }

  // 5. Get messages
  const msgListRes = await fetch(
    `${API_BASE}/threads/${threadId}/messages`,
    {
      headers: { Authorization: `Bearer ${DASHSCOPE_KEY}` },
    }
  );
  const msgList = await msgListRes.json();

  // Find assistant response
  let content = "";
  for (const m of msgList.data || []) {
    if (m.role === "assistant") {
      for (const c of m.content || []) {
        if (c.type === "text") {
          content = c.text?.value || c.text || "";
        }
      }
    }
    if (content) break;
  }

  // Parse JSON
  const trimmed = content.trim();
  const jsonMatch =
    trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) ||
    trimmed.match(/\{[\s\S]*"columns"[\s\S]*"rows"[\s\S]*\}/);

  const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]).trim() : trimmed;

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

export async function POST(request: NextRequest) {
  try {
    const { images, instruction } = await request.json();

    if (!images || !Array.isArray(images) || images.length === 0) {
      return NextResponse.json({ error: "No images provided" }, { status: 400 });
    }

    if (!DASHSCOPE_KEY) {
      return NextResponse.json(
        { error: "DASHSCOPE_API_KEY not configured" },
        { status: 500 }
      );
    }

    const results = [];
    for (let i = 0; i < images.length; i++) {
      const result = await callAssistant(images[i], instruction || "");
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
