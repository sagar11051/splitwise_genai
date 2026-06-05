"use client";

import { use, useMemo, useState, useRef, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import Avatar from "@/components/Avatar";
import { useStore } from "@/store/useStore";
import { computeNetBalances } from "@/lib/ledger";
import { formatPaise, categoryEmoji } from "@/lib/utils";
import type { ProposedChange } from "@/app/api/agent/mediate/route";

// ── Types ─────────────────────────────────────────────────────────────────────
type MessageRole = "user" | "ai";
type ChatMessage = {
  role: MessageRole;
  text: string;
  proposedChange?: ProposedChange | null;
};

// Equal split helper — deterministic
function equalSplitPaise(paise: number, ids: string[]): Record<string, number> {
  const n = ids.length;
  const share = Math.floor(paise / n);
  const rem = paise - share * n;
  const out: Record<string, number> = {};
  ids.forEach((id, i) => { out[id] = share + (i === 0 ? rem : 0); });
  return out;
}

// ── Quick question chips ──────────────────────────────────────────────────────
const QUICK_QUESTIONS = [
  "Why do I owe so much?",
  "Who spent the most overall?",
  "Was the split fair?",
  "Which expense is the biggest?",
];

// ── Inner component (uses useSearchParams) ────────────────────────────────────
function MediateInner({ id }: { id: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { groups, expenses, currentUserId, getUserById, updateExpense } = useStore();

  const group = groups.find((g) => g.id === id);
  const groupExpenses = useMemo(
    () => expenses.filter((e) => e.groupId === id).sort((a, b) => b.dateISO.localeCompare(a.dateISO)),
    [expenses, id]
  );

  const netBalances = useMemo(() => {
    if (!group) return {};
    return computeNetBalances(groupExpenses, group.memberIds);
  }, [groupExpenses, group]);

  // ── Chat state ────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState(searchParams.get("q") ?? "");
  const [sending, setSending] = useState(false);
  const [appliedChanges, setAppliedChanges] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Auto-send if question came from URL param
  const autoSentRef = useRef(false);
  useEffect(() => {
    const q = searchParams.get("q");
    if (q && !autoSentRef.current) {
      autoSentRef.current = true;
      setInputText(q);
    }
  }, [searchParams]);

  if (!group) {
    return (
      <AppShell>
        <div className="p-8 text-center" style={{ color: "var(--sw-ink-soft)" }}>Group not found.</div>
      </AppShell>
    );
  }

  const currentUser = getUserById(currentUserId);

  // ── Build request payload ─────────────────────────────────────────────────
  function buildPayload(question: string) {
    const memberMap: Record<string, string> = {};
    group!.memberIds.forEach((uid) => {
      memberMap[uid] = uid === currentUserId ? "You" : (getUserById(uid)?.name ?? uid);
    });

    const expenseContext = groupExpenses.map((e) => {
      const paidByName = Object.keys(e.paidBy)[0];
      const payer = paidByName === currentUserId ? "You" : (getUserById(paidByName)?.name ?? paidByName);
      const splitLines = Object.entries(e.splitAmong).map(([uid, paise]) => {
        const name = uid === currentUserId ? "You" : (getUserById(uid)?.name ?? uid);
        return `${name} ₹${Math.round(paise / 100)}`;
      });
      return {
        id: e.id,
        description: e.description,
        amountPaise: e.amountPaise,
        paidByName: payer,
        splitLines,
        category: e.category,
        dateISO: e.dateISO,
      };
    });

    const balances = group!.memberIds.map((uid) => ({
      name: uid === currentUserId ? "You" : (getUserById(uid)?.name ?? uid),
      amountPaise: netBalances[uid] ?? 0,
    }));

    return {
      question,
      expenses: expenseContext,
      balances,
      memberMap,
      groupName: group!.name,
      currentUserName: currentUser?.name ?? "You",
    };
  }

  // ── Send question ─────────────────────────────────────────────────────────
  async function handleSend(questionOverride?: string) {
    const question = (questionOverride ?? inputText).trim();
    if (!question || sending) return;

    setMessages((prev) => [...prev, { role: "user", text: question }]);
    setInputText("");
    setSending(true);

    try {
      const res = await fetch("/api/agent/mediate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(question)),
      });

      if (res.status === 429) {
        setMessages((prev) => [...prev, { role: "ai", text: "AI is busy right now. Try again in a moment." }]);
        return;
      }
      if (!res.ok) {
        setMessages((prev) => [...prev, { role: "ai", text: "Something went wrong. Try again." }]);
        return;
      }

      const data = await res.json();
      setMessages((prev) => [...prev, {
        role: "ai",
        text: data.reply ?? "I couldn't answer that. Try rephrasing.",
        proposedChange: data.proposedChange ?? null,
      }]);
    } catch {
      setMessages((prev) => [...prev, { role: "ai", text: "Connection error. Try again." }]);
    } finally {
      setSending(false);
    }
  }

  // ── Apply proposed change (Ledger Engine does the math) ──────────────────
  function handleApplyChange(change: ProposedChange) {
    const expense = groupExpenses.find((e) => e.id === change.expenseId);
    if (!expense) return;

    // Deterministic split — model only told us WHO, we compute the PAISE
    const newSplitAmong = equalSplitPaise(expense.amountPaise, change.equalSplitAmong);
    updateExpense(change.expenseId, { splitAmong: newSplitAmong });
    setAppliedChanges((prev) => new Set(prev).add(change.expenseId));
    setMessages((prev) => [...prev, {
      role: "ai",
      text: `Done! Split for "${change.expenseDescription}" updated. Balances recalculated.`,
    }]);
  }

  return (
    <AppShell>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="px-4 pt-10 pb-4" style={{ background: "var(--sw-green-deep)" }}>
        <button onClick={() => router.back()} className="text-white/60 text-sm mb-3 flex items-center gap-1">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl" style={{ background: "rgba(255,255,255,0.12)" }}>
            {group.emoji}
          </div>
          <div>
            <h1 className="text-white text-xl font-bold">Sort It Out</h1>
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>{group.name} · {groupExpenses.length} expenses</p>
          </div>
        </div>
      </header>

      {/* ── Quick questions ─────────────────────────────────────────────── */}
      {messages.length === 0 && (
        <div className="px-4 pt-3 pb-2">
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--sw-ink-soft)" }}>
            Quick questions
          </p>
          <div className="flex flex-wrap gap-2">
            {QUICK_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => handleSend(q)}
                className="text-xs px-3 py-1.5 rounded-full border font-medium transition-colors"
                style={{ borderColor: "var(--sw-divider)", color: "var(--sw-ink)", background: "white" }}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Chat thread ─────────────────────────────────────────────────── */}
      <div className="flex-1 px-4 py-3 space-y-3 overflow-y-auto">
        {messages.length === 0 && (
          <div
            className="rounded-2xl p-4"
            style={{ border: "1px solid var(--sw-divider)", background: "white" }}
          >
            <p className="text-sm font-medium" style={{ color: "var(--sw-ink)" }}>
              Ask anything about {group.name}&apos;s expenses
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--sw-ink-soft)" }}>
              Grounded in your exact ledger.
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} animate-fade-up`} style={{ animationDuration: "0.2s" }}>
            <div className="max-w-[85%] space-y-2">
              {/* Message bubble */}
              <div
                className="rounded-2xl px-4 py-3 text-sm leading-relaxed"
                style={
                  msg.role === "user"
                    ? { background: "var(--sw-green)", color: "white", borderBottomRightRadius: "6px" }
                    : { background: "white", color: "var(--sw-ink)", border: "1px solid var(--sw-divider)", borderBottomLeftRadius: "6px", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }
                }
              >
                {msg.text}
              </div>

              {/* Proposed change confirmation card */}
              {msg.role === "ai" && msg.proposedChange && !appliedChanges.has(msg.proposedChange.expenseId) && (
                <div
                  className="rounded-2xl overflow-hidden animate-fade-up"
                  style={{ border: "1px solid var(--sw-divider)", background: "white", boxShadow: "0 2px 8px rgba(0,0,0,0.05)", animationDuration: "0.25s" }}
                >
                  <div style={{ height: "2px", background: "var(--sw-green)" }} />
                  <div className="px-4 py-2.5 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase" style={{ color: "var(--sw-ink-soft)", letterSpacing: "0.08em" }}>Suggested change</span>
                  </div>
                  <div className="px-4 py-3 space-y-2">
                    <p className="text-sm font-semibold" style={{ color: "var(--sw-ink)" }}>
                      {msg.proposedChange.expenseDescription}
                    </p>
                    <p className="text-xs" style={{ color: "var(--sw-ink-soft)" }}>
                      New split: equally between{" "}
                      <span className="font-semibold">
                        {msg.proposedChange.equalSplitAmong
                          .map((uid) => uid === currentUserId ? "you" : (getUserById(uid)?.name ?? uid))
                          .join(", ")}
                      </span>
                    </p>
                    {/* Computed amounts — deterministic, not from model */}
                    {(() => {
                      const exp = groupExpenses.find((e) => e.id === msg.proposedChange!.expenseId);
                      if (!exp) return null;
                      const newSplits = equalSplitPaise(exp.amountPaise, msg.proposedChange!.equalSplitAmong);
                      return (
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(newSplits).map(([uid, paise]) => (
                            <span key={uid} className="text-xs px-2 py-0.5 rounded-full font-money font-semibold"
                              style={{ background: "var(--sw-bg)", color: "var(--sw-ink)" }}>
                              {uid === currentUserId ? "You" : (getUserById(uid)?.name ?? uid)}: {formatPaise(paise)}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                    <p className="text-xs" style={{ color: "var(--sw-ink-soft)" }}>{msg.proposedChange.reason}</p>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => handleApplyChange(msg.proposedChange!)}
                        className="flex-1 py-2 rounded-xl text-white text-xs font-semibold"
                        style={{ background: "var(--sw-green)" }}
                      >
                        Apply change
                      </button>
                      <button
                        onClick={() => setMessages((prev) =>
                          prev.map((m, idx) => idx === i ? { ...m, proposedChange: null } : m)
                        )}
                        className="px-3 py-2 rounded-xl border text-xs font-medium"
                        style={{ borderColor: "var(--sw-divider)", color: "var(--sw-ink-soft)" }}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Applied badge */}
              {msg.role === "ai" && msg.proposedChange && appliedChanges.has(msg.proposedChange.expenseId) && (
                <div className="text-xs px-3 py-1.5 rounded-full inline-flex items-center gap-1" style={{ background: "var(--sw-bg)", color: "var(--sw-ink-soft)", border: "1px solid var(--sw-divider)" }}>
                  ✓ Applied
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Sending indicator */}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl px-4 py-3 flex gap-1.5 items-center" style={{ background: "white", border: "1px solid var(--sw-divider)" }}>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full"
                  style={{
                    background: "var(--sw-green)",
                    animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                  }}
                />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Input bar (pinned above bottom nav) ─────────────────────────── */}
      <div
        className="px-4 py-3 border-t"
        style={{ background: "white", borderColor: "var(--sw-divider)" }}
      >
        <div className="flex gap-2 items-end">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
            }}
            placeholder="Ask anything about this group's expenses…"
            rows={1}
            disabled={sending}
            className="flex-1 rounded-xl border px-3 py-2.5 text-sm resize-none focus:outline-none"
            style={{
              borderColor: inputText ? "var(--sw-green)" : "var(--sw-divider)",
              color: "var(--sw-ink)",
              maxHeight: "96px",
              transition: "border-color 0.15s",
            }}
          />
          <button
            onClick={() => handleSend()}
            disabled={!inputText.trim() || sending}
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-opacity disabled:opacity-40"
            style={{ background: "var(--sw-green)" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-6px); }
        }
      `}</style>
    </AppShell>
  );
}

export default function MediatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<div className="flex-1 flex items-center justify-center" style={{ color: "var(--sw-ink-soft)" }}>Loading…</div>}>
      <MediateInner id={id} />
    </Suspense>
  );
}
