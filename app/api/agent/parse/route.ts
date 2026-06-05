/**
 * POST /api/agent/parse  —  F1 Parser Agent
 *
 * THE GOLDEN RULE: the model describes STRUCTURE only; every paise value
 * is computed here in deterministic TypeScript (never by the LLM).
 *
 * Two ways the model can express a non-equal split:
 *
 * A) subExpenses — for the common pattern: a sub-total applies to a SUBSET
 *    of people (e.g. "drinks ₹1200, Rahul didn't drink, rest equal").
 *    Model outputs the sub-totals and who's in each; route splits each sub
 *    equally among its members, then aggregates.
 *    A sub-expense with amountRupees: null means "the remainder" — route
 *    computes: remainder = total − sum(stated sub-totals).
 *
 * B) explicitSplitRupees — for the simpler pattern: a person's exact total
 *    share is directly stated ("Rahul pays 300, rest equal").
 *    Model echoes only those stated amounts; route distributes the remainder
 *    equally among everyone else.
 *
 * If neither applies → equal split.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { callGemini } from "@/lib/gemini";

// ── Request schema ─────────────────────────────────────────────────────────
const MemberSchema = z.object({ id: z.string(), name: z.string() });
const RequestSchema = z.object({
  text: z.string().min(1).max(600),
  members: z.array(MemberSchema).min(1),
  currentUserId: z.string(),
});

// ── What Gemini returns ────────────────────────────────────────────────────
const SubExpenseSchema = z.object({
  description: z.string(),
  amountRupees: z.number().nullable(), // null = "the remainder"
  splitAmongNames: z.array(z.string()),
});

const ParserOutputSchema = z.object({
  description: z.string().nullable().optional(),
  amountRupees: z.number().nullable().optional(),
  paidByName: z.string().nullable().optional(),
  splitAmongNames: z.array(z.string()).default([]),
  // Use subExpenses when a sub-total applies to a subset of people.
  subExpenses: z.array(SubExpenseSchema).nullable().optional(),
  // Use explicitSplitRupees when a specific person's TOTAL share is directly stated.
  explicitSplitRupees: z.record(z.string(), z.number()).nullable().optional(),
  category: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});
type ParserOutput = z.infer<typeof ParserOutputSchema>;

// ── Gemini schema (OpenAPI subset) ─────────────────────────────────────────
const GEMINI_SCHEMA = {
  type: "object",
  properties: {
    description: { type: "string" },
    amountRupees: { type: "number" },
    paidByName: { type: "string" },
    splitAmongNames: { type: "array", items: { type: "string" } },
    subExpenses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          amountRupees: { type: "number" },
          splitAmongNames: { type: "array", items: { type: "string" } },
        },
        required: ["description", "splitAmongNames"],
      },
    },
    explicitSplitRupees: { type: "object" },
    category: {
      type: "string",
      enum: ["food", "transport", "accommodation", "activity", "groceries", "utilities", "rent", "entertainment", "other"],
    },
    notes: { type: "string" },
  },
  required: ["description", "amountRupees", "paidByName", "splitAmongNames", "category"],
};

// ── System prompt ──────────────────────────────────────────────────────────
function buildSystemPrompt(
  members: { id: string; name: string }[],
  currentUserId: string
): string {
  const meEntry = members.find((m) => m.id === currentUserId);
  const memberList = members
    .map((m) => `  - "${m.id === currentUserId ? "me" : m.name}"`)
    .join("\n");

  return `You extract structured expense data from casual English/Hinglish text.

GROUP MEMBERS (use EXACTLY these names as keys everywhere):
${memberList}
"me", "mai", "main", "mujhe", "mein", "maine", "I" all refer to the current user${meEntry ? ` ("${meEntry.name}")` : ""}. Always use "me" for them.

OUTPUT FIELDS:

description: SHORT clean title, 2-5 words max. NOT the input text. Good: "Electricity bill", "Goa cab". Bad: repeating the full input.

amountRupees: total amount as a plain number (no ₹ symbol).

paidByName: who paid. Use "me" if current user paid ("maine diya", "I paid", "diya", etc.).

splitAmongNames: everyone who shares ANY part of this expense.

--- HOW TO HANDLE SPLITS (pick ONE method) ---

METHOD 1 — subExpenses: use whenever ANY person is excluded from part of the expense.
This covers two common patterns:

PATTERN A — Item/activity exclusion:
"3000 total, drinks 1200, Rahul ne drink nahi kiya, rest equal among all 3"
→ subExpenses: [
    { "description": "drinks",  "amountRupees": 1200, "splitAmongNames": ["me", "Priya"] },
    { "description": "food",    "amountRupees": null,  "splitAmongNames": ["me", "Rahul", "Priya"] }
  ]
Use amountRupees: null for the "rest"/"baki" — the app computes the remainder automatically.

PATTERN B — Period/duration exclusion (someone only covered for N out of M months/days):
"2000 electricity for 2 months, Aman only pays for 1 month"
→ per-period amount = 2000 / 2 = 1000 (you MAY compute total ÷ stated_periods — this is the ONLY arithmetic allowed)
→ subExpenses: [
    { "description": "month 1", "amountRupees": 1000, "splitAmongNames": ["me", "Rahul", "Aman"] },
    { "description": "month 2", "amountRupees": 1000, "splitAmongNames": ["me", "Rahul"] }
  ]
If M > 2 periods: create one sub-expense per group of people sharing the same set.
If "rest" is cleaner, use null for the last sub-expense amount.

PATTERN C — Named flat exclusion:
"Rahul didn't come for the second half, cab was 600, split 3 ways then 2 ways"
→ subExpenses: [
    { "description": "first half",  "amountRupees": 300, "splitAmongNames": ["me", "Rahul", "Priya"] },
    { "description": "second half", "amountRupees": null, "splitAmongNames": ["me", "Priya"] }
  ]

GOLDEN RULE for subExpenses: only output sub-totals and who's in each. NEVER compute per-person shares.

METHOD 2 — explicitSplitRupees: use ONLY when a person's FULL share is directly stated as a rupee amount.
"Rahul pays 300, rest equal" → explicitSplitRupees: { "Rahul": 300 }
Echo only the stated amount. Do NOT calculate anyone else's share.

METHOD 3 — neither (both null/absent): simple equal split.
"equally", "aadha aadha", "barabar", "split between" with no amounts.

RULES:
- Per-person division is ALWAYS the app's job. You never compute ₹X ÷ N people.
- The only arithmetic you may do: total ÷ number_of_periods for PATTERN B.
- category: best fit from the enum.
- notes: any relevant context, or null.
- If something is unclear, leave it null so the user can correct it.`;
}

// ── Name resolver ──────────────────────────────────────────────────────────
const FIRST_PERSON = new Set([
  "me", "i", "myself", "my",
  "main", "mai", "mujhe", "mein", "maine", "hum",
]);

function resolveName(
  raw: string,
  members: { id: string; name: string }[],
  currentUserId: string
): string | null {
  const lower = raw.toLowerCase().trim();
  if (FIRST_PERSON.has(lower)) return currentUserId;

  const meEntry = members.find((m) => m.id === currentUserId);
  if (meEntry && meEntry.name.toLowerCase() === lower) return currentUserId;

  const exact = members.find((m) => m.name.toLowerCase() === lower);
  if (exact) return exact.id;

  if (lower.length >= 2) {
    const partial = members.find(
      (m) =>
        m.name.toLowerCase().startsWith(lower) ||
        lower.startsWith(m.name.toLowerCase())
    );
    if (partial) return partial.id;
  }
  return null;
}

function resolveNames(
  names: string[],
  members: { id: string; name: string }[],
  currentUserId: string
): string[] {
  return names
    .map((n) => resolveName(n, members, currentUserId))
    .filter((id): id is string => id !== null)
    .filter((id, i, arr) => arr.indexOf(id) === i);
}

// ── Deterministic split builders (GOLDEN RULE: no LLM math) ───────────────

/** Equal split with remainder to first person. */
function equalSplitPaise(
  amountPaise: number,
  ids: string[]
): Record<string, number> {
  const n = ids.length;
  if (n === 0) return {};
  const share = Math.floor(amountPaise / n);
  const rem = amountPaise - share * n;
  const out: Record<string, number> = {};
  ids.forEach((id, i) => { out[id] = share + (i === 0 ? rem : 0); });
  return out;
}

/**
 * METHOD 1 — sub-expenses.
 * Each sub-expense is split equally among its own member list.
 * A sub with amountRupees===null gets the remaining paise.
 */
function buildSplitFromSubExpenses(
  totalPaise: number,
  subs: { description: string; amountRupees: number | null; splitAmongNames: string[] }[],
  allSplitIds: string[],
  members: { id: string; name: string }[],
  currentUserId: string
): Record<string, number> {
  // Compute remainder = total − sum of stated sub-amounts
  let statedSum = 0;
  for (const s of subs) {
    if (s.amountRupees != null) statedSum += Math.round(s.amountRupees * 100);
  }
  const remainderPaise = totalPaise - statedSum;

  // Initialise all participants at 0
  const result: Record<string, number> = {};
  for (const id of allSplitIds) result[id] = 0;

  for (const sub of subs) {
    const subPaise = sub.amountRupees != null
      ? Math.round(sub.amountRupees * 100)
      : remainderPaise;

    const subIds = resolveNames(sub.splitAmongNames, members, currentUserId)
      .filter((id) => id in result);

    if (subIds.length === 0 || subPaise <= 0) continue;

    const shares = equalSplitPaise(subPaise, subIds);
    for (const [id, amt] of Object.entries(shares)) {
      result[id] = (result[id] ?? 0) + amt;
    }
  }

  return result;
}

/**
 * METHOD 2 — explicit per-person totals (names as keys from model output).
 * Distributes remainder equally among everyone not explicitly stated.
 */
function buildSplitFromExplicit(
  totalPaise: number,
  splitAmongIds: string[],
  explicitByName: Record<string, number>,
  members: { id: string; name: string }[],
  currentUserId: string
): Record<string, number> {
  const explicitPaise: Record<string, number> = {};
  let explicitTotal = 0;

  for (const [name, rupees] of Object.entries(explicitByName)) {
    const id = resolveName(name, members, currentUserId);
    if (id && splitAmongIds.includes(id)) {
      const p = Math.round(rupees * 100);
      explicitPaise[id] = p;
      explicitTotal += p;
    }
  }

  const nonExplicit = splitAmongIds.filter((id) => !(id in explicitPaise));
  const remaining = totalPaise - explicitTotal;
  const result: Record<string, number> = { ...explicitPaise };

  if (nonExplicit.length > 0) {
    const shares = equalSplitPaise(remaining, nonExplicit);
    for (const [id, amt] of Object.entries(shares)) result[id] = amt;
  } else if (remaining !== 0 && splitAmongIds[0]) {
    // Rounding dust: absorb into first person
    result[splitAmongIds[0]] = (result[splitAmongIds[0]] ?? 0) + remaining;
  }

  return result;
}

// ── Route handler ──────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const req$ = RequestSchema.safeParse(body);
  if (!req$.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { text, members, currentUserId } = req$.data;

  const geminiResult = await callGemini<ParserOutput>({
    systemInstruction: buildSystemPrompt(members, currentUserId),
    userText: text,
    geminiSchema: GEMINI_SCHEMA,
    zodSchema: ParserOutputSchema,
    temperature: 0.1,
    thinkingBudget: 0,
  });

  if (!geminiResult.ok) {
    return NextResponse.json(
      { error: geminiResult.error, rateLimited: geminiResult.rateLimited },
      { status: geminiResult.rateLimited ? 429 : 500 }
    );
  }

  const raw = geminiResult.data;

  // ── Resolve names → IDs ──────────────────────────────────────────────
  const paidById =
    raw.paidByName
      ? (resolveName(raw.paidByName, members, currentUserId) ?? currentUserId)
      : currentUserId;

  const splitAmongIds = resolveNames(
    raw.splitAmongNames ?? [],
    members,
    currentUserId
  );
  if (splitAmongIds.length === 0) splitAmongIds.push(currentUserId);

  const amountPaise =
    raw.amountRupees != null ? Math.round(raw.amountRupees * 100) : null;

  // ── Compute per-person split deterministically ───────────────────────
  let splitAmounts: Record<string, number> | null = null;
  let isEqualSplit = true;
  let splitMethod: "subExpenses" | "explicit" | "equal" = "equal";

  if (amountPaise != null) {
    const hasSubs =
      Array.isArray(raw.subExpenses) && raw.subExpenses.length > 0;
    const hasExplicit =
      raw.explicitSplitRupees != null &&
      Object.keys(raw.explicitSplitRupees).length > 0;

    if (hasSubs) {
      splitAmounts = buildSplitFromSubExpenses(
        amountPaise,
        raw.subExpenses!,
        splitAmongIds,
        members,
        currentUserId
      );
      isEqualSplit = false;
      splitMethod = "subExpenses";
    } else if (hasExplicit) {
      splitAmounts = buildSplitFromExplicit(
        amountPaise,
        splitAmongIds,
        raw.explicitSplitRupees!,
        members,
        currentUserId
      );
      isEqualSplit = false;
      splitMethod = "explicit";
    } else {
      splitAmounts = equalSplitPaise(amountPaise, splitAmongIds);
      isEqualSplit = true;
      splitMethod = "equal";
    }
  }

  return NextResponse.json({
    draft: {
      description: raw.description ?? null,
      amountPaise,
      paidBy: paidById,
      splitAmong: splitAmongIds,
      splitAmounts,
      isEqualSplit,
      category: raw.category ?? "other",
      notes: raw.notes ?? null,
    },
    _splitMethod: splitMethod,
    _raw: raw,
  });
}
