/**
 * POST /api/agent/mediate  —  F4 Mediator Agent
 *
 * Answers questions about a group's ledger, grounded in the exact numbers
 * provided from the Ledger Engine. The model NEVER recomputes balances.
 *
 * If a correction is warranted, returns proposedChange with:
 *   - expenseId  — the expense to patch
 *   - equalSplitAmong — userIds who should share it (app computes paise)
 * The client Zod-validates this before showing the confirm card.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { callGemini } from "@/lib/gemini";

// ── Request ─────────────────────────────────────────────────────────────────
const ExpenseContextSchema = z.object({
  id: z.string(),
  description: z.string(),
  amountPaise: z.number(),
  paidByName: z.string(),
  splitLines: z.array(z.string()), // ["You ₹800", "Rahul ₹800", ...]
  category: z.string(),
  dateISO: z.string(),
});

const RequestSchema = z.object({
  question: z.string().min(1).max(400),
  expenses: z.array(ExpenseContextSchema),
  balances: z.array(z.object({ name: z.string(), amountPaise: z.number() })),
  memberMap: z.record(z.string(), z.string()), // userId → name
  groupName: z.string(),
  currentUserName: z.string(),
});

// ── proposedChange Zod schema (validated client-side before applying) ───────
export const ProposedChangeSchema = z.object({
  expenseId: z.string(),
  expenseDescription: z.string(),
  equalSplitAmong: z.array(z.string()).min(1), // userIds — app computes paise
  reason: z.string(),
});
export type ProposedChange = z.infer<typeof ProposedChangeSchema>;

// ── Gemini response schema ───────────────────────────────────────────────────
const GEMINI_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    proposedChange: {
      type: "object",
      properties: {
        expenseId: { type: "string" },
        expenseDescription: { type: "string" },
        equalSplitAmong: { type: "array", items: { type: "string" } },
        reason: { type: "string" },
      },
      required: ["expenseId", "expenseDescription", "equalSplitAmong", "reason"],
    },
  },
  required: ["reply"],
};

const MediatorOutputSchema = z.object({
  reply: z.string(),
  proposedChange: z.object({
    expenseId: z.string(),
    expenseDescription: z.string(),
    equalSplitAmong: z.array(z.string()),
    reason: z.string(),
  }).nullable().optional(),
});

// ── System prompt ────────────────────────────────────────────────────────────
function buildSystemPrompt(
  memberMap: Record<string, string>,
  currentUserName: string
): string {
  const memberLines = Object.entries(memberMap)
    .map(([id, name]) => `  • "${name}" = ${id}`)
    .join("\n");

  return `You are a fair, neutral dispute mediator for a shared-expense group.

You receive a group's EXACT expense list and computed balances. Your job is to answer questions factually and helpfully, referencing the data provided.

MEMBER ID → NAME MAPPING (use these IDs in proposedChange.equalSplitAmong):
${memberLines}
Current user: "${currentUserName}"

RULES:
- Answer factually. Cite specific expenses by name and exact amounts.
- Never recalculate balances yourself — reference the provided computed balances.
- Be neutral and constructive. Don't take sides.
- Keep replies concise (2-4 sentences).

WHEN TO SUGGEST A CHANGE:
Only propose a change if the user explicitly asks for a correction AND it's clearly supported by what they've said. Return proposedChange with:
  - expenseId: the exact ID from the expense list
  - expenseDescription: the expense name (for display)
  - equalSplitAmong: array of userIds who should split it equally (the app computes the actual paise — you do NOT)
  - reason: one clear sentence explaining why

If no change is warranted, omit proposedChange entirely (or return null).`;
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const req$ = RequestSchema.safeParse(body);
  if (!req$.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { question, expenses, balances, memberMap, groupName, currentUserName } = req$.data;

  // Build the expense context string (exact numbers, given to model)
  const expenseLines = expenses
    .slice(0, 20) // cap at 20 to stay within token budget
    .map((e) => {
      const splits = e.splitLines.join(", ");
      return `[ID: ${e.id}] "${e.description}" — ₹${Math.round(e.amountPaise / 100)} · paid by ${e.paidByName} · split: ${splits}`;
    })
    .join("\n");

  const balanceLines = balances
    .map((b) => {
      const sign = b.amountPaise >= 0 ? "+" : "";
      return `  • ${b.name}: ${sign}₹${Math.round(b.amountPaise / 100)} (${b.amountPaise >= 0 ? "is owed" : "owes"})`;
    })
    .join("\n");

  const userText = `GROUP: ${groupName}

EXPENSES:
${expenseLines}

COMPUTED BALANCES (exact — do not recalculate):
${balanceLines}

USER QUESTION:
${question}`;

  const result = await callGemini<z.infer<typeof MediatorOutputSchema>>({
    systemInstruction: buildSystemPrompt(memberMap, currentUserName),
    userText,
    geminiSchema: GEMINI_SCHEMA,
    zodSchema: MediatorOutputSchema,
    temperature: 0.2,
    thinkingBudget: 512,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, rateLimited: result.rateLimited },
      { status: result.rateLimited ? 429 : 500 }
    );
  }

  const { reply, proposedChange } = result.data;

  // Validate proposedChange with Zod before passing to client
  let safeChange: ProposedChange | null = null;
  if (proposedChange) {
    const pc$ = ProposedChangeSchema.safeParse(proposedChange);
    safeChange = pc$.success ? pc$.data : null;
  }

  return NextResponse.json({ reply, proposedChange: safeChange });
}
