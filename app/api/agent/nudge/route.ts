/**
 * POST /api/agent/nudge  —  F3 Nudge Agent
 *
 * Drafts 3 tone-appropriate WhatsApp payment reminders.
 * Each message ends with {{UPI_LINK}} — the client replaces this with
 * the actual UPI deep-link before opening WhatsApp.
 *
 * Temperature 0.6 for natural, varied output across tones.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { callGemini } from "@/lib/gemini";

const TONES = ["gentle", "friendly", "funny", "firm"] as const;

const RequestSchema = z.object({
  debtorName: z.string(),
  creditorName: z.string(),
  amountRupees: z.number().positive(),
  context: z.string().max(200),
  tone: z.enum(TONES),
});

// Gemini schema — returns array of 3 message strings
const GEMINI_SCHEMA = {
  type: "object",
  properties: {
    messages: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["messages"],
};

const NudgeResponseSchema = z.object({
  messages: z.array(z.string()).min(2).max(4),
});

const TONE_GUIDE: Record<typeof TONES[number], string> = {
  gentle:
    "Warm, soft, zero pressure. Like gently reminding a close friend over chai. Absolutely no guilt, no shame, no 'you always forget'. End with encouragement.",
  friendly:
    "Upbeat and chatty, like WhatsApp-texting a good friend. Hinglish totally welcome ('yaar', 'bhai', 'ek kaam kar'). Light and breezy.",
  funny:
    "Playful and humorous. Self-deprecating about needing the money (not about the other person). Light meme energy. Hinglish welcome. Never mean-spirited. Make them laugh AND pay.",
  firm:
    "Clear, direct, professional. States the facts plainly. Not rude or cold — just no-nonsense. No filler phrases. Gets to the point in sentence 1.",
};

const SYSTEM = `You write WhatsApp-ready payment reminder messages for an Indian audience.

Write EXACTLY 3 short message options. Each must:
1. Be 2–4 sentences. Short enough to send on WhatsApp without scrolling.
2. Include the exact amount ₹{AMOUNT} (do not round or change it).
3. End with this exact placeholder on its own line: {{UPI_LINK}}
   (The app will replace this with a real UPI payment link.)
4. Feel natural — written by a real person, not a bank bot.

Tone instruction is given below. Follow it strictly.
GENTLE and FRIENDLY: Never say anything guilt-inducing. No "you always forget", "disappointed", "embarrassing", etc.
Return JSON: { "messages": ["msg1", "msg2", "msg3"] }`;

export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const req$ = RequestSchema.safeParse(body);
  if (!req$.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { debtorName, creditorName, amountRupees, context, tone } = req$.data;

  const userText = `Draft 3 payment reminders.
Debtor (who owes): ${debtorName}
Creditor (who is owed): ${creditorName}
Amount: ₹${amountRupees}
Context: ${context}
Tone: ${tone.toUpperCase()} — ${TONE_GUIDE[tone]}`;

  const result = await callGemini<z.infer<typeof NudgeResponseSchema>>({
    systemInstruction: SYSTEM.replace("{AMOUNT}", String(amountRupees)),
    userText,
    geminiSchema: GEMINI_SCHEMA,
    zodSchema: NudgeResponseSchema,
    temperature: 0.65,
    thinkingBudget: 0,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, rateLimited: result.rateLimited },
      { status: result.rateLimited ? 429 : 500 }
    );
  }

  return NextResponse.json({ messages: result.data.messages });
}
