import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { requireRole } from "@/lib/auth/rbac";
import { generateText } from "@/lib/ai/client";
import { z } from "zod";

const bodySchema = z.object({
  documentId: z.string(),
  content: z.string().max(50_000), // cap what we send to the AI provider too
  mode: z.enum(["summarize", "improve", "continue"]).default("summarize"),
});

const PROMPTS: Record<string, (text: string) => string> = {
  summarize: (text) => `Summarize the following document in 2-3 concise sentences:\n\n${text}`,
  improve: (text) => `Suggest 3 concrete improvements (clarity, structure, tone) for this document. Bullet points only:\n\n${text}`,
  continue: (text) => `Continue writing the next paragraph of this document, matching its tone:\n\n${text}`,
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 });

  const { documentId, content, mode } = parsed.data;
  const access = await requireRole(documentId, session.user.id, "VIEWER");
  if (!access.ok) return NextResponse.json({ error: "forbidden" }, { status: access.status });

  try {
    const result = await generateText(PROMPTS[mode](content));
    return NextResponse.json({ result });
  } catch (err) {
    return NextResponse.json(
      { error: "AI feature unavailable — no provider key configured" },
      { status: 503 }
    );
  }
}
