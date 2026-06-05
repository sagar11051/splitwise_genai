/**
 * POST /api/agent/explain  —  F2 Explainer Agent
 *
 * Receives the EXACT simplified-debt list from the Ledger Engine.
 * Returns 1–2 plain-language sentences describing the settlement.
 * The model ONLY narrates — all numbers are given to it, never computed by it.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { callGemini } from "@/lib/gemini";

const RequestSchema = z.object({
  settlements: z.array(
    z.object({
      fromName: z.string(),
      toName: z.string(),
      amountPaise: z.number(),
    })
  ),
  groupName: z.string(),
  memberCount: z.number(),
});

const SYSTEM = `You are a friendly assistant that explains simplified group debt settlements in warm, concise Indian English.

You receive an EXACT list of suggested payments — every rupee amount was computed by the app, not by you.

Your job:
- Write 1–2 natural sentences summarising the settlements.
- If the number of payments is less than the maximum possible, mention the simplification warmly: e.g. "Instead of 6 transfers, just 2 payments clear everything."
- "You" refers to the reader; use their name when available.
- Echo the given amounts EXACTLY — never round, add, or change any rupee figure.
- Keep it under 55 words. Plain prose — no bullet points, no markdown.
- Warm, encouraging tone. No guilt-tripping.`;

export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const req$ = RequestSchema.safeParse(body);
  if (!req$.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { settlements, groupName, memberCount } = req$.data;

  const maxPossible = Math.floor((memberCount * (memberCount - 1)) / 2);

  const settlementLines = settlements
    .map((s) => `• ${s.fromName} pays ${s.toName}: ₹${Math.round(s.amountPaise / 100)}`)
    .join("\n");

  const userText = `Group: "${groupName}" (${memberCount} members)
Simplified to ${settlements.length} payment${settlements.length !== 1 ? "s" : ""} (max possible: ${maxPossible}):
${settlementLines}`;

  const result = await callGemini<string>({
    systemInstruction: SYSTEM,
    userText,
    temperature: 0.2,
    thinkingBudget: 0,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, rateLimited: result.rateLimited },
      { status: result.rateLimited ? 429 : 500 }
    );
  }

  return NextResponse.json({ explanation: result.data });
}
