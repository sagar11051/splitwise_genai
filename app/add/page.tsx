"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import Avatar from "@/components/Avatar";
import { useStore } from "@/store/useStore";
import { newId, formatPaise, categoryEmoji } from "@/lib/utils";
import { Expense } from "@/lib/types";

// ── Types ─────────────────────────────────────────────────────────────────────
type ParsedDraft = {
  description: string | null;
  amountPaise: number | null;
  paidBy: string;
  splitAmong: string[];
  splitAmounts: Record<string, number> | null;
  isEqualSplit: boolean;
  category: string;
  notes: string | null;
};

type RawAIOutput = {
  description?: string | null;
  amountRupees?: number | null;
  paidByName?: string | null;
  splitAmongNames?: string[];
  subExpenses?: { description: string; amountRupees: number | null; splitAmongNames: string[] }[] | null;
  explicitSplitRupees?: Record<string, number> | null;
  category?: string | null;
  notes?: string | null;
};

type SplitMethod = "subExpenses" | "explicit" | "equal";
type SmartMode = "idle" | "parsing" | "confirming" | "error";

const CATEGORIES = [
  "food", "transport", "accommodation", "activity",
  "groceries", "utilities", "rent", "entertainment", "other",
];

// ── Deterministic equal-split helper (mirrors ledger, client-side) ────────────
function equalSplit(amountPaise: number, ids: string[]): Record<string, number> {
  const n = ids.length;
  if (n === 0) return {};
  const share = Math.floor(amountPaise / n);
  const rem = amountPaise - share * n;
  const result: Record<string, number> = {};
  ids.forEach((id, i) => { result[id] = share + (i === 0 ? rem : 0); });
  return result;
}

// ── Main page (inner — needs Suspense for useSearchParams) ───────────────────
function AddExpenseInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { users, groups, currentUserId, getUserById, addExpense } = useStore();

  // Pre-select group from query param if coming from a group page
  const initialGroup = searchParams.get("group") ?? (groups[0]?.id ?? "");
  const [selectedGroupId, setSelectedGroupId] = useState(initialGroup);

  const selectedGroup = groups.find((g) => g.id === selectedGroupId);
  const members = (selectedGroup?.memberIds ?? [])
    .map((id) => users.find((u) => u.id === id))
    .filter(Boolean) as typeof users;

  // ── Smart Add state ──────────────────────────────────────────────────────
  const [smartMode, setSmartMode] = useState<SmartMode>("idle");
  const [smartText, setSmartText] = useState(searchParams.get("q") ?? "");
  const [errorMsg, setErrorMsg] = useState("");
  const [rawJSON, setRawJSON] = useState<RawAIOutput | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [splitMethod, setSplitMethod] = useState<SplitMethod>("equal");

  // Confirmation card editable state (populated after parse)
  const [cfDesc, setCfDesc] = useState("");
  const [cfAmountRupees, setCfAmountRupees] = useState("");
  const [cfPaidById, setCfPaidById] = useState(currentUserId);
  const [cfSplitIds, setCfSplitIds] = useState<string[]>([]);
  const [cfSplitAmounts, setCfSplitAmounts] = useState<Record<string, number> | null>(null);
  const [cfIsEqual, setCfIsEqual] = useState(true);
  const [cfCategory, setCfCategory] = useState("other");

  // ── Manual form state ────────────────────────────────────────────────────
  const [manualDesc, setManualDesc] = useState("");
  const [manualAmount, setManualAmount] = useState("");
  const [manualPaidBy, setManualPaidBy] = useState(currentUserId);
  const [manualCategory, setManualCategory] = useState("food");
  const [manualSplitMode, setManualSplitMode] = useState<"equal" | "custom">("equal");
  const [customSplits, setCustomSplits] = useState<Record<string, string>>({});
  const [manualNotes, setManualNotes] = useState("");

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const confirmCardRef = useRef<HTMLDivElement>(null);
  const autoParseRef = useRef(false);

  // Scroll confirmation card into view after parse
  useEffect(() => {
    if (smartMode === "confirming" && confirmCardRef.current) {
      confirmCardRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [smartMode]);

  // Auto-parse when arriving from the command bar (?q= param)
  useEffect(() => {
    const q = searchParams.get("q");
    if (q && !autoParseRef.current && members.length > 0 && smartMode === "idle") {
      autoParseRef.current = true;
      handleSmartParse(q);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members.length]);

  // ── Smart Add — call /api/agent/parse ────────────────────────────────────
  async function handleSmartParse(textOverride?: string) {
    const text = (textOverride ?? smartText).trim();
    if (textOverride) setSmartText(textOverride);
    if (!text || members.length === 0) return;

    setSmartMode("parsing");
    setErrorMsg("");
    setRawJSON(null);

    const memberPayload = members.map((m) => ({
      id: m.id,
      name: m.id === currentUserId ? "me" : m.name,
    }));

    try {
      const res = await fetch("/api/agent/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          members: memberPayload,
          currentUserId,
        }),
      });

      if (res.status === 429) {
        setErrorMsg("AI is busy right now (rate limit). Fill in manually below.");
        setSmartMode("error");
        return;
      }

      if (!res.ok) {
        setErrorMsg("Couldn't parse that. Fill in manually below.");
        setSmartMode("error");
        return;
      }

      const data = await res.json();
      const draft: ParsedDraft = data.draft;
      setRawJSON(data._raw ?? null);
      setSplitMethod(data._splitMethod ?? "equal");

      // Pre-fill confirmation card
      setCfDesc(draft.description ?? "");
      setCfAmountRupees(draft.amountPaise ? String(draft.amountPaise / 100) : "");
      setCfPaidById(draft.paidBy ?? currentUserId);
      setCfSplitIds(draft.splitAmong.length > 0 ? draft.splitAmong : members.map((m) => m.id));
      setCfSplitAmounts(draft.splitAmounts);
      setCfIsEqual(draft.isEqualSplit);
      setCfCategory(draft.category ?? "other");

      setSmartMode("confirming");
    } catch {
      setErrorMsg("Connection error. Fill in manually below.");
      setSmartMode("error");
    }
  }

  // ── Confirm — deterministic Ledger Engine saves ──────────────────────────
  function handleConfirm() {
    const amountPaise = Math.round(parseFloat(cfAmountRupees) * 100);
    if (!cfDesc.trim() || isNaN(amountPaise) || amountPaise <= 0) return;

    // All arithmetic is deterministic — LLM never touched this
    const splits = cfSplitAmounts
      ? cfSplitAmounts  // already computed in route handler
      : equalSplit(amountPaise, cfSplitIds);

    const expense: Expense = {
      id: newId("exp"),
      groupId: selectedGroupId || undefined,
      description: cfDesc.trim(),
      amountPaise,
      paidBy: { [cfPaidById]: amountPaise },
      splitAmong: splits,
      category: cfCategory,
      dateISO: new Date().toISOString().slice(0, 10),
      createdVia: "smartadd",
      notes: undefined,
    };

    addExpense(expense);
    router.push(selectedGroupId ? `/group/${selectedGroupId}` : "/");
  }

  // ── Manual form submit ───────────────────────────────────────────────────
  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amountPaise = Math.round(parseFloat(manualAmount) * 100);
    if (!manualDesc || isNaN(amountPaise) || amountPaise <= 0) return;

    let splits: Record<string, number>;
    if (manualSplitMode === "equal") {
      splits = equalSplit(amountPaise, members.map((m) => m.id));
    } else {
      splits = {};
      let total = 0;
      for (const m of members) {
        const val = Math.round(parseFloat(customSplits[m.id] ?? "0") * 100);
        splits[m.id] = val;
        total += val;
      }
      if (Math.abs(total - amountPaise) > 1) {
        alert("Split amounts don't add up. Check your values.");
        return;
      }
    }

    const expense: Expense = {
      id: newId("exp"),
      groupId: selectedGroupId || undefined,
      description: manualDesc.trim(),
      amountPaise,
      paidBy: { [manualPaidBy]: amountPaise },
      splitAmong: splits,
      category: manualCategory,
      dateISO: new Date().toISOString().slice(0, 10),
      createdVia: "manual",
      notes: manualNotes.trim() || undefined,
    };

    addExpense(expense);
    router.push(selectedGroupId ? `/group/${selectedGroupId}` : "/");
  }

  // ── Derived: displayed split for confirmation card ───────────────────────
  const displaySplitAmounts: Record<string, number> = (() => {
    const paise = Math.round(parseFloat(cfAmountRupees) * 100);
    if (isNaN(paise) || paise <= 0) return {};
    if (cfSplitAmounts) {
      // Recompute if amount changed from original
      const origPaise = Object.values(cfSplitAmounts).reduce((a, b) => a + b, 0);
      if (Math.abs(origPaise - paise) < 2) return cfSplitAmounts;
    }
    return equalSplit(paise, cfSplitIds);
  })();

  return (
    <AppShell>
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <header
        className="px-4 pt-10 pb-4 border-b"
        style={{ background: "white", borderColor: "var(--sw-divider)" }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            style={{ color: "var(--sw-ink-soft)" }}
            aria-label="Close"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <h1 className="text-lg font-bold" style={{ color: "var(--sw-ink)" }}>
            Add expense
          </h1>
        </div>
      </header>

      <div className="flex-1 px-4 py-4 space-y-5">
        {/* ── Group selector (shown in both modes) ─────────────────────── */}
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide block mb-1.5" style={{ color: "var(--sw-ink-soft)" }}>
            Group
          </label>
          <select
            value={selectedGroupId}
            onChange={(e) => setSelectedGroupId(e.target.value)}
            className="w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none"
            style={{ borderColor: "var(--sw-divider)", color: "var(--sw-ink)" }}
            disabled={smartMode === "parsing"}
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.emoji} {g.name}</option>
            ))}
          </select>
        </div>

        {/* ── SMART ADD ─────────────────────────────────────────────────── */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{ border: "1px solid var(--sw-divider)", background: "white" }}
        >
          <div className="p-4">
            <div className="flex items-center gap-2 mb-4">
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                <path d="M7 1v2M7 11v2M1 7h2M11 7h2M2.93 2.93l1.42 1.42M9.65 9.65l1.42 1.42M9.65 4.35l1.42-1.42M2.93 11.07l1.42-1.42"
                  stroke="var(--sw-green)" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <span className="text-xs font-semibold uppercase" style={{ color: "var(--sw-ink-soft)", letterSpacing: "0.08em" }}>
                Smart Add
              </span>
            </div>

            <div className="relative mb-4">
              <textarea
                ref={textareaRef}
                value={smartText}
                onChange={(e) => setSmartText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSmartParse();
                  }
                }}
                placeholder={"paid 1200 for dinner, Rahul 300, rest equal\naaj cab ke 240 diye, mai aur Sara aadha aadha"}
                rows={3}
                disabled={smartMode === "parsing" || smartMode === "confirming"}
                className="w-full text-sm resize-none focus:outline-none"
                style={{
                  border: "none",
                  padding: 0,
                  color: "var(--sw-ink)",
                  background: "transparent",
                  lineHeight: "1.7",
                }}
              />
              {smartMode === "parsing" && (
                <div className="absolute inset-0 rounded-xl shimmer" />
              )}
              <div className="mt-3" style={{ borderBottom: "1px solid var(--sw-divider)" }} />
            </div>

            {smartMode === "error" && (
              <p
                className="text-xs mb-3 px-3 py-2 rounded-lg"
                style={{ color: "var(--sw-owe)", background: "rgba(255,101,47,0.06)" }}
              >
                {errorMsg}
              </p>
            )}

            {smartMode !== "confirming" && (
              <button
                onClick={() => handleSmartParse()}
                disabled={!smartText.trim() || smartMode === "parsing" || members.length === 0}
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-40"
                style={{ background: "var(--sw-green)" }}
              >
                {smartMode === "parsing" ? "Parsing…" : "Parse →"}
              </button>
            )}
          </div>
        </div>

        {/* ── CONFIRMATION CARD ─────────────────────────────────────────── */}
        {smartMode === "confirming" && (
          <div
            ref={confirmCardRef}
            className="rounded-2xl overflow-hidden animate-fade-up"
            style={{
              border: "1px solid var(--sw-divider)",
              background: "white",
              boxShadow: "0 2px 12px rgba(0,0,0,0.05)",
              animationDuration: "0.35s",
            }}
          >
            {/* Green top accent bar */}
            <div style={{ height: "2px", background: "var(--sw-green)" }} />

            {/* Header */}
            <div className="px-4 pt-3.5 pb-0 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase" style={{ color: "var(--sw-ink-soft)", letterSpacing: "0.08em" }}>
                Review
              </span>
              <button
                onClick={() => setSmartMode("idle")}
                className="text-xs"
                style={{ color: "var(--sw-ink-soft)" }}
              >
                Start over
              </button>
            </div>

            <div className="px-4 py-4 space-y-4">
              {/* Description */}
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide block mb-1" style={{ color: "var(--sw-ink-soft)", letterSpacing: "0.06em" }}>
                  Description
                </label>
                <input
                  type="text"
                  value={cfDesc}
                  onChange={(e) => setCfDesc(e.target.value)}
                  className="w-full py-1.5 text-sm focus:outline-none bg-transparent"
                  style={{ borderBottom: "1px solid var(--sw-divider)", color: "var(--sw-ink)" }}
                  placeholder="What was this for?"
                />
              </div>

              {/* Amount */}
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide block mb-1" style={{ color: "var(--sw-ink-soft)", letterSpacing: "0.06em" }}>
                  Amount (₹)
                </label>
                <input
                  type="number"
                  value={cfAmountRupees}
                  onChange={(e) => {
                    setCfAmountRupees(e.target.value);
                    setCfSplitAmounts(null);
                    setCfIsEqual(true);
                  }}
                  min="0.01"
                  step="0.01"
                  className="w-full py-1.5 text-sm focus:outline-none font-money bg-transparent"
                  style={{ borderBottom: "1px solid var(--sw-divider)", color: "var(--sw-ink)" }}
                  placeholder="0"
                />
              </div>

              {/* Paid by */}
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide block mb-2" style={{ color: "var(--sw-ink-soft)", letterSpacing: "0.06em" }}>
                  Paid by
                </label>
                <div className="flex gap-2 flex-wrap">
                  {members.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setCfPaidById(m.id)}
                      className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium border transition-colors"
                      style={{
                        background: cfPaidById === m.id ? "var(--sw-green)" : "white",
                        color: cfPaidById === m.id ? "white" : "var(--sw-ink)",
                        borderColor: cfPaidById === m.id ? "var(--sw-green)" : "var(--sw-divider)",
                      }}
                    >
                      {m.id === currentUserId ? "You" : m.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Split breakdown */}
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide block mb-2" style={{ color: "var(--sw-ink-soft)", letterSpacing: "0.06em" }}>
                  Split{" "}
                  <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>
                    {splitMethod === "subExpenses" ? "(computed)" : splitMethod === "explicit" ? "(stated)" : "(equal)"}
                  </span>
                </label>
                <div className="space-y-0.5">
                  {members.map((m) => {
                    const inSplit = cfSplitIds.includes(m.id);
                    const share = displaySplitAmounts[m.id];
                    return (
                      <div
                        key={m.id}
                        className="flex items-center gap-3 py-2 transition-opacity"
                        style={{ opacity: inSplit ? 1 : 0.35 }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            const next = inSplit
                              ? cfSplitIds.filter((id) => id !== m.id)
                              : [...cfSplitIds, m.id];
                            setCfSplitIds(next);
                            setCfSplitAmounts(null);
                            setCfIsEqual(true);
                          }}
                          className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                          style={{ background: inSplit ? "var(--sw-green)" : "var(--sw-divider)" }}
                          aria-label={inSplit ? `Remove ${m.name}` : `Add ${m.name}`}
                        >
                          {inSplit && (
                            <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                              <polyline points="2 6 5 9 10 3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </button>
                        <Avatar name={m.name} color={m.color} size="sm" />
                        <span className="flex-1 text-sm font-medium" style={{ color: "var(--sw-ink)" }}>
                          {m.id === currentUserId ? "You" : m.name}
                        </span>
                        {inSplit && share != null && (
                          <span
                            className="text-sm font-semibold font-money"
                            style={{ color: cfIsEqual ? "var(--sw-ink-soft)" : "var(--sw-owe)" }}
                          >
                            {formatPaise(share)}
                            {splitMethod === "explicit" && !cfIsEqual && (
                              <span className="text-xs font-normal ml-1" style={{ color: "var(--sw-ink-soft)" }}>(stated)</span>
                            )}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Category */}
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide block mb-1" style={{ color: "var(--sw-ink-soft)", letterSpacing: "0.06em" }}>
                  Category
                </label>
                <select
                  value={cfCategory}
                  onChange={(e) => setCfCategory(e.target.value)}
                  className="w-full py-1.5 text-sm focus:outline-none bg-transparent"
                  style={{ borderBottom: "1px solid var(--sw-divider)", color: "var(--sw-ink)" }}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{categoryEmoji(c)} {c.charAt(0).toUpperCase() + c.slice(1)}</option>
                  ))}
                </select>
              </div>

              {/* Raw AI JSON — debug */}
              {rawJSON && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowRaw((v) => !v)}
                    className="text-xs flex items-center gap-1"
                    style={{ color: "var(--sw-ink-soft)" }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <polyline points={showRaw ? "18 15 12 9 6 15" : "6 9 12 15 18 9"} />
                    </svg>
                    {showRaw ? "Hide" : "Show"} raw AI response
                  </button>
                  {showRaw && (
                    <pre
                      className="mt-2 text-xs p-3 rounded-xl overflow-x-auto animate-fade-up"
                      style={{
                        background: "var(--sw-bg)",
                        color: "var(--sw-ink-soft)",
                        fontFamily: "monospace",
                        animationDuration: "0.2s",
                      }}
                    >
                      {JSON.stringify(rawJSON, null, 2)}
                    </pre>
                  )}
                </div>
              )}

              {/* Confirm / dismiss */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleConfirm}
                  disabled={!cfDesc.trim() || !cfAmountRupees || cfSplitIds.length === 0}
                  className="flex-1 py-3 rounded-xl text-white font-semibold text-sm transition-opacity disabled:opacity-40"
                  style={{ background: "var(--sw-green)" }}
                >
                  Confirm & Save
                </button>
                <button
                  onClick={() => setSmartMode("idle")}
                  className="px-4 py-3 rounded-xl text-sm font-medium border"
                  style={{ color: "var(--sw-ink-soft)", borderColor: "var(--sw-divider)" }}
                >
                  Edit
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* ── MANUAL FORM ─────────────────────────────────────────────── */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px" style={{ background: "var(--sw-divider)" }} />
            <span className="text-xs font-medium" style={{ color: "var(--sw-ink-soft)" }}>
              or add manually
            </span>
            <div className="flex-1 h-px" style={{ background: "var(--sw-divider)" }} />
          </div>

          <form onSubmit={handleManualSubmit} className="space-y-4">
            {/* Description */}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide block mb-1.5" style={{ color: "var(--sw-ink-soft)" }}>
                Description
              </label>
              <input
                type="text"
                value={manualDesc}
                onChange={(e) => setManualDesc(e.target.value)}
                placeholder="What was this for?"
                className="w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none"
                style={{ borderColor: "var(--sw-divider)", color: "var(--sw-ink)" }}
              />
            </div>

            {/* Amount */}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide block mb-1.5" style={{ color: "var(--sw-ink-soft)" }}>
                Amount (₹)
              </label>
              <input
                type="number"
                value={manualAmount}
                onChange={(e) => setManualAmount(e.target.value)}
                placeholder="0"
                min="0.01"
                step="0.01"
                className="w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none font-money"
                style={{ borderColor: "var(--sw-divider)", color: "var(--sw-ink)" }}
              />
            </div>

            {/* Paid by */}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide block mb-1.5" style={{ color: "var(--sw-ink-soft)" }}>
                Paid by
              </label>
              <div className="flex gap-2 flex-wrap">
                {members.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setManualPaidBy(m.id)}
                    className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium border transition-colors"
                    style={{
                      background: manualPaidBy === m.id ? "var(--sw-green)" : "white",
                      color: manualPaidBy === m.id ? "white" : "var(--sw-ink)",
                      borderColor: manualPaidBy === m.id ? "var(--sw-green)" : "var(--sw-divider)",
                    }}
                  >
                    {m.id === currentUserId ? "You" : m.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Category */}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide block mb-1.5" style={{ color: "var(--sw-ink-soft)" }}>
                Category
              </label>
              <select
                value={manualCategory}
                onChange={(e) => setManualCategory(e.target.value)}
                className="w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none"
                style={{ borderColor: "var(--sw-divider)", color: "var(--sw-ink)" }}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{categoryEmoji(c)} {c.charAt(0).toUpperCase() + c.slice(1)}</option>
                ))}
              </select>
            </div>

            {/* Split mode */}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide block mb-1.5" style={{ color: "var(--sw-ink-soft)" }}>
                Split
              </label>
              <div className="flex gap-2 mb-3">
                {(["equal", "custom"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setManualSplitMode(mode)}
                    className="flex-1 py-2 rounded-xl text-sm font-medium border transition-colors"
                    style={{
                      background: manualSplitMode === mode ? "var(--sw-green)" : "white",
                      color: manualSplitMode === mode ? "white" : "var(--sw-ink)",
                      borderColor: manualSplitMode === mode ? "var(--sw-green)" : "var(--sw-divider)",
                    }}
                  >
                    {mode === "equal" ? "Equally" : "Custom"}
                  </button>
                ))}
              </div>
              {manualSplitMode === "custom" && (
                <div className="space-y-2">
                  {members.map((m) => (
                    <div key={m.id} className="flex items-center gap-3">
                      <Avatar name={m.name} color={m.color} size="sm" />
                      <span className="flex-1 text-sm font-medium" style={{ color: "var(--sw-ink)" }}>
                        {m.id === currentUserId ? "You" : m.name}
                      </span>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: "var(--sw-ink-soft)" }}>₹</span>
                        <input
                          type="number"
                          value={customSplits[m.id] ?? ""}
                          onChange={(e) => setCustomSplits((prev) => ({ ...prev, [m.id]: e.target.value }))}
                          placeholder="0"
                          min="0"
                          step="0.01"
                          className="w-24 rounded-xl border pl-7 pr-3 py-2 text-sm font-money focus:outline-none"
                          style={{ borderColor: "var(--sw-divider)", color: "var(--sw-ink)" }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Notes */}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide block mb-1.5" style={{ color: "var(--sw-ink-soft)" }}>
                Notes (optional)
              </label>
              <input
                type="text"
                value={manualNotes}
                onChange={(e) => setManualNotes(e.target.value)}
                placeholder="Any context…"
                className="w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none"
                style={{ borderColor: "var(--sw-divider)", color: "var(--sw-ink)" }}
              />
            </div>

            <button
              type="submit"
              className="w-full py-3.5 rounded-2xl text-white font-semibold text-base transition-opacity active:opacity-80"
              style={{ background: "var(--sw-green)" }}
            >
              Save expense
            </button>
          </form>
        </div>

        <div className="h-6" />
      </div>
    </AppShell>
  );
}

export default function AddExpensePage() {
  return (
    <Suspense fallback={<div className="flex-1 flex items-center justify-center" style={{ color: "var(--sw-ink-soft)" }}>Loading…</div>}>
      <AddExpenseInner />
    </Suspense>
  );
}
