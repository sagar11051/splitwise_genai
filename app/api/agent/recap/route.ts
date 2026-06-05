/**
 * POST /api/agent/recap  —  F5 Recap Agent
 *
 * Receives exact group totals from the Ledger Engine (groupTotals + simplifyDebts).
 * Returns a fun 3–5 sentence shareable trip recap.
 * Numbers come ONLY from the data passed in — model narrates, never calculates.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { callGemini } from "@/lib/gemini";

const RequestSchema = z.object({
  groupName: z.string(),
  emoji: z.string(),
  groupType: z.enum(["trip", "flat", "other"]),
  totalPaise: z.number(),
  byCategory: z.record(z.string(), z.number()),
  byPayer: z.record(z.string(), z.number()),      // userId → paise they fronted
  memberNames: z.record(z.string(), z.string()),  // userId → display name
  settlements: z.array(z.object({
    fromName: z.string(),
    toName: z.string(),
    amountPaise: z.number(),
  })),
  expenseCount: z.number(),
});

const SYSTEM = `You write fun, shareable group expense recaps — like a WhatsApp message everyone would enjoy reading.

Given exact statistics about a group's expenses, write 3–5 sentences that:
1. Open with the total spent and the group name (keep it punchy).
2. Mention who fronted the most — by name, with their exact amount.
3. Call out the biggest spending category and its amount.
4. Restate the settle-up clearly: "To clear up, [name] pays [name] ₹X" (use exact provided amounts).
5. End with a light celebratory line (trip: travel emoji + "GG"; flat: "smooth"; other: positive).

STRICT RULES:
- Use ONLY the exact rupee amounts given. Never round, estimate, or invent any number.
- Use *bold* sparingly for WhatsApp formatting (amounts, names are good candidates).
- Warm, casual tone — reads like a group-chat post, not a finance report.
- Hinglish is welcome ("kyaa baat", "maza aaya", "GG", etc.) for trip-type groups.
- Keep it under 120 words total.`;

export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const req$ = RequestSchema.safeParse(body);
  if (!req$.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { groupName, emoji, groupType, totalPaise, byCategory, byPayer, memberNames, settlements, expenseCount } = req$.data;

  // Build richly-contextual prompt (all numbers exact, from Ledger Engine)
  const totalRupees = Math.round(totalPaise / 100);
  const topPayer = Object.entries(byPayer).sort((a, b) => b[1] - a[1])[0];
  const topCategory = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0];

  const payerLines = Object.entries(byPayer)
    .sort((a, b) => b[1] - a[1])
    .map(([id, p]) => `  • ${memberNames[id] ?? id}: fronted ₹${Math.round(p / 100)}`)
    .join("\n");

  const categoryLines = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, p]) => `  • ${cat}: ₹${Math.round(p / 100)}`)
    .join("\n");

  const settleLines = settlements.length === 0
    ? "  • Everyone is even — no payments needed!"
    : settlements
        .map((s) => `  • ${s.fromName} → ${s.toName}: ₹${Math.round(s.amountPaise / 100)}`)
        .join("\n");

  const userText = `Group: ${emoji} ${groupName} (type: ${groupType})
Total spent: ₹${totalRupees} across ${expenseCount} expense${expenseCount !== 1 ? "s" : ""}

Who paid what:
${payerLines}
(Top payer: ${memberNames[topPayer?.[0]] ?? "?"}, ₹${Math.round((topPayer?.[1] ?? 0) / 100)})

By category:
${categoryLines}
(Biggest category: ${topCategory?.[0] ?? "?"}, ₹${Math.round((topCategory?.[1] ?? 0) / 100)})

Settle-up (exact — do not change these amounts):
${settleLines}`;

  const result = await callGemini<string>({
    systemInstruction: SYSTEM,
    userText,
    temperature: 0.6,
    thinkingBudget: 0,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, rateLimited: result.rateLimited },
      { status: result.rateLimited ? 429 : 500 }
    );
  }

  return NextResponse.json({ recap: result.data });
}
