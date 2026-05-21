import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const DASHSCOPE_KEY = process.env.DASHSCOPE_API_KEY || "";
const DASHSCOPE_BASE = "https://dashscope.aliyuncs.com";

function pdfToBase64Png(pdfBase64: string): string[] {
  const tmpDir = join(tmpdir(), "pdf2img_" + Date.now());
  mkdirSync(tmpDir, { recursive: true });

  const pdfPath = join(tmpDir, "input.pdf");
  const pdfBytes = Buffer.from(pdfBase64, "base64");
  writeFileSync(pdfPath, pdfBytes);

  try {
    const script = `
import fitz, base64, sys, json, os

doc = fitz.open("${pdfPath}")
result = []
for i in range(len(doc)):
    page = doc[i]
    pix = page.get_pixmap(matrix=fitz.Matrix(2,2))
    b64 = base64.b64encode(pix.tobytes("png")).decode()
    result.append(b64)
doc.close()
print(json.dumps(result))
`;
    const out = execSync(`python3 -c '${script}'`, {
      encoding: "utf-8",
      timeout: 30000,
    });
    return JSON.parse(out.trim());
  } finally {
    // Cleanup
    try {
      unlinkSync(pdfPath);
    } catch {}
  }
}

async function callQwenVL(imageBase64: string, instruction: string) {
  const prompt = instruction
    ? `请从这张图片中提取以下信息：${instruction}\n\n只输出纯 JSON，格式：{"columns":["列名1","列名2",...],"rows":[["值1","值2",...],...]}`
    : `请从这张图片中提取所有结构化数据，只输出纯 JSON，格式：{"columns":["列名1","列名2",...],"rows":[["值1","值2",...],...]}`;

  const response = await fetch(
    `${DASHSCOPE_BASE}/compatible-mode/v1/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DASHSCOPE_KEY}`,
        "Content-Type": "application/json",
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
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API error: ${response.status} - ${err}`);
  }

  const data = await response.json();
  let content = data.choices?.[0]?.message?.content || "";

  const cleaned = content
    .replace(/```(?:json)?\s*/g, "")
    .replace(/\s*```/g, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    return { columns: parsed.columns || [], rows: parsed.rows || [] };
  } catch {
    const m = cleaned.match(/\{[\s\S]*"columns"[\s\S]*"rows"[\s\S]*\}/);
    if (m) {
      try {
        const parsed = JSON.parse(m[0]);
        return { columns: parsed.columns || [], rows: parsed.rows || [] };
      } catch {}
    }
  }

  return { columns: [], rows: [], raw: content };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { images, pdfBase64, instruction } = body;

    if (!DASHSCOPE_KEY) {
      return NextResponse.json(
        { error: "DASHSCOPE_API_KEY not configured" },
        { status: 500 }
      );
    }

    const results = [];

    if (pdfBase64) {
      // PDF received - convert to images via Python PyMuPDF
      const pages = pdfToBase64Png(pdfBase64);
      for (let i = 0; i < pages.length; i++) {
        const r = await callQwenVL(pages[i], instruction || "");
        results.push({ page: i + 1, ...r });
      }
    } else if (images?.length) {
      // Direct image(s) received
      for (let i = 0; i < images.length; i++) {
        const r = await callQwenVL(images[i], instruction || "");
        results.push({ page: i + 1, ...r });
      }
    } else {
      return NextResponse.json({ error: "No PDF or images provided" }, { status: 400 });
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
