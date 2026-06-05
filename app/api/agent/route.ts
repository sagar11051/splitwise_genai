/**
 * POST /api/agent/route  —  F6 Orchestrator
 *
 * Classifies free-text into one of 5 navigation intents.
 * ALWAYS returns HTTP 200 — errors downgrade to intent:"unknown".
 * The client never sees a 5xx; it always gets a navigable result.
 *
 * Design principle (per user feedback):
 *   The command bar is a fast-forward button to the right screen.
 *   It does NOT complete the action — the destination screen does.
 *   - add    → /add?q=text  (user picks group + confirms there)
 *   - nudge  → /friend/[id]/nudge  (user picks tone + sends there)
 *   - settle → /group/[id]/settle
 *   - recap  → /group/[id]/recap
 *   - mediate→ /group/[id]/mediate?q=question
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { callGemini } from "@/lib/gemini";

// ── Request ───────────────────────────────────────────────────────────────────
const RequestSchema = z.object({
  text: z.string().min(1).max(300),
  groups: z.array(z.object({ id: z.string(), name: z.string(), type: z.string() })),
  members: z.array(z.object({ id: z.string(), name: z.string() })),
});

// ── Gemini schema ─────────────────────────────────────────────────────────────
const GEMINI_SCHEMA = {
  type: "object",
  properties: {
    intent:   { type: "string", enum: ["add", "nudge", "settle", "recap", "mediate", "unknown"] },
    groupId:  { type: "string" },
    memberId: { type: "string" },
    text:     { type: "string" },
    question: { type: "string" },
    reply:    { type: "string" },
  },
  required: ["intent"],
};

// Fault-tolerant Zod schema — .catch() fallbacks mean a malformed AI response
// never causes a 5xx. The intent defaults to "unknown" if the field is invalid.
const OrchestratorOutputSchema = z.object({
  intent:   z.enum(["add", "nudge", "settle", "recap", "mediate", "unknown"]).catch("unknown"),
  groupId:  z.string().nullable().optional().catch(null),
  memberId: z.string().nullable().optional().catch(null),
  text:     z.string().nullable().optional().catch(null),
  question: z.string().nullable().optional().catch(null),
  reply:    z.string().nullable().optional().catch(null),
});

type OrchestratorOutput = z.infer<typeof OrchestratorOutputSchema>;

// ── System prompt ─────────────────────────────────────────────────────────────
function buildSystemPrompt(
  groups: { id: string; name: string; type: string }[],
  members: { id: string; name: string }[]
): string {
  const groupLines = groups
    .map((g) => `  ${g.name}  →  id="${g.id}"`)
    .join("\n");

  const memberLines = members
    .map((m) => `  ${m.name}  →  id="${m.id}"`)
    .join("\n");

  return `You route commands in a shared-expense app to the right screen.
Return JSON with EXACTLY one of these intent values: "add" "nudge" "settle" "recap" "mediate" "unknown".
No other value is valid.

GROUPS:
${groupLines}

PEOPLE (friends):
${memberLines}

--- ROUTING RULES ---

intent = "add"
  When: user wants to log / record / split an expense.
  Signals: any expense description, amounts, food/travel names, "paid", "diya", "split", "add".
  → text = preserve the full input text exactly (Smart Add parses it on the next screen).
  → NO groupId needed — user selects group on the Add Expense screen.
  Examples: "add 500 biryani", "paid 1200 dinner with Rahul Sara", "aaj cab 240 mai aur Sara"

intent = "nudge"
  When: user wants to send a payment reminder to someone.
  Signals: "nudge", "remind", "message", "tell [name] to pay".
  → memberId = matched person's id. If name not found, set memberId to null.

intent = "settle"
  When: user wants to see settle-up payments for a group.
  Signals: "settle", "pay", "clear dues", "how to pay", "who owes".
  → groupId = best matching group id. Default to first group if unclear.

intent = "recap"
  When: user wants a narrative summary of a group's expenses.
  Signals: "recap", "summary", "how much we spent", "what happened in [trip]".
  → groupId = best matching group id.

intent = "mediate"
  When: user asks a question about expenses, balances, or a dispute.
  Signals: "why", "explain", "how much do I owe", "was it fair", any question mark.
  → groupId = most relevant group id.
  → question = user's exact words.

intent = "unknown"
  When: cannot classify confidently.
  → reply = short one-line hint with 2-3 concrete command examples.

MATCHING: case-insensitive, partial ("goa" → Goa Trip, "rahul" → Rahul).
Return JSON only. No extra fields.`;
}

// ── Route handler ─────────────────────────────────────────────────────────────
const FALLBACK: OrchestratorOutput = {
  intent: "unknown",
  reply: "Try: 'add 500 biryani', 'nudge Rahul', 'settle up Goa', 'recap Goa trip'.",
  groupId: null,
  memberId: null,
  text: null,
  question: null,
};

export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json(FALLBACK);
  }

  const req$ = RequestSchema.safeParse(body);
  if (!req$.success) {
    return NextResponse.json(FALLBACK);
  }

  const { text, groups, members } = req$.data;

  const result = await callGemini<OrchestratorOutput>({
    systemInstruction: buildSystemPrompt(groups, members),
    userText: text,
    geminiSchema: GEMINI_SCHEMA,
    zodSchema: OrchestratorOutputSchema,
    temperature: 0.1,
    thinkingBudget: 0,
  });

  // Always 200 — errors fall back to unknown gracefully
  if (!result.ok) {
    return NextResponse.json({
      ...FALLBACK,
      reply: result.rateLimited
        ? "AI is busy — try again in a moment."
        : FALLBACK.reply,
    });
  }

  // For add intent: always pass the original text if model didn't return one
  const out = result.data;
  if (out.intent === "add" && !out.text) {
    out.text = text;
  }

  return NextResponse.json(out);
}
