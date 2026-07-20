import OpenAI from "openai";
import Groq from "groq-sdk";

/**
 * Provider-agnostic AI helper. Picks whichever key is present in .env —
 * lets you swap between OpenAI and Groq (or add Gemini similarly) without
 * touching call sites. Keeps AI as a genuine add-on rather than a hard
 * dependency: if neither key is set, callers should treat this as
 * unavailable and degrade gracefully (see api/ai/summarize/route.ts).
 */
export async function generateText(prompt: string, maxTokens = 300): Promise<string> {
  if (process.env.GROQ_API_KEY) {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const res = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
    });
    return res.choices[0]?.message?.content ?? "";
  }

  if (process.env.OPENAI_API_KEY) {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
    });
    return res.choices[0]?.message?.content ?? "";
  }

  throw new Error("No AI provider configured — set OPENAI_API_KEY or GROQ_API_KEY");
}
