"use client";

import { use, useMemo, useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import Avatar from "@/components/Avatar";
import { useStore } from "@/store/useStore";
import { computeNetBalances, simplifyDebts } from "@/lib/ledger";
import { formatPaise, buildUpiLink } from "@/lib/utils";

type CopiedState = Record<number, boolean>;

export default function SettlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { groups, expenses, currentUserId, getUserById } = useStore();

  const group = groups.find((g) => g.id === id);
  const groupExpenses = useMemo(
    () => expenses.filter((e) => e.groupId === id),
    [expenses, id]
  );

  // ── All arithmetic is deterministic — Ledger Engine only ─────────────────
  const netBalances = useMemo(() => {
    if (!group) return {};
    return computeNetBalances(groupExpenses, group.memberIds);
  }, [groupExpenses, group]);

  const settlements = useMemo(() => simplifyDebts(netBalances), [netBalances]);

  // ── AI Explanation (Explainer Agent) ─────────────────────────────────────
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current || settlements.length === 0 || !group) return;
    fetchedRef.current = true;
    setExplainLoading(true);

    const settlementPayload = settlements.map((s) => ({
      fromName: s.from === currentUserId ? "you" : (getUserById(s.from)?.name ?? s.from),
      toName: s.to === currentUserId ? "you" : (getUserById(s.to)?.name ?? s.to),
      amountPaise: s.amount,
    }));

    fetch("/api/agent/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settlements: settlementPayload,
        groupName: group.name,
        memberCount: group.memberIds.length,
      }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data?.explanation) setExplanation(data.explanation); })
      .catch(() => {})
      .finally(() => setExplainLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settlements.length, group?.id]);

  // ── UPI copy state ────────────────────────────────────────────────────────
  const [copied, setCopied] = useState<CopiedState>({});

  function copyUpiId(idx: number, upiId: string) {
    navigator.clipboard.writeText(upiId).catch(() => {});
    setCopied((prev) => ({ ...prev, [idx]: true }));
    setTimeout(() => setCopied((prev) => ({ ...prev, [idx]: false })), 2000);
  }

  if (!group) {
    return (
      <AppShell>
        <div className="p-8 text-center" style={{ color: "var(--sw-ink-soft)" }}>Group not found.</div>
      </AppShell>
    );
  }

  const myBalance = netBalances[currentUserId] ?? 0;

  return (
    <AppShell>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="px-4 pt-10 pb-5" style={{ background: "var(--sw-green-deep)" }}>
        <button
          onClick={() => router.back()}
          className="text-white/60 text-sm mb-3 flex items-center gap-1"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <div className="flex items-center gap-3">
          <div
            className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl"
            style={{ background: "rgba(255,255,255,0.12)" }}
          >
            {group.emoji}
          </div>
          <div>
            <h1 className="text-white text-xl font-bold">Settle Up</h1>
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>{group.name}</p>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-4 space-y-4">
        {settlements.length === 0 ? (
          /* ── All settled ─────────────────────────────────────────────── */
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-5xl mb-4">🎉</div>
            <h2 className="text-lg font-bold mb-1" style={{ color: "var(--sw-ink)" }}>
              All settled up!
            </h2>
            <p className="text-sm" style={{ color: "var(--sw-ink-soft)" }}>
              Everyone in {group.name} is even.
            </p>
          </div>
        ) : (
          <>
            {/* ── AI Explanation ──────────────────────────────────────────── */}
            <div
              className="rounded-2xl overflow-hidden"
              style={{ border: "1px solid var(--sw-divider)", background: "white" }}
            >
              <div style={{ height: "2px", background: "var(--sw-green)" }} />
              <div className="px-4 py-3">
                {explainLoading ? (
                  <div className="space-y-2">
                    <div className="h-3.5 rounded shimmer" style={{ width: "92%" }} />
                    <div className="h-3.5 rounded shimmer" style={{ width: "75%" }} />
                  </div>
                ) : explanation ? (
                  <p
                    className="text-sm leading-relaxed animate-fade-up"
                    style={{ color: "var(--sw-ink)" }}
                  >
                    {explanation}
                  </p>
                ) : (
                  <p className="text-sm" style={{ color: "var(--sw-ink-soft)" }}>
                    {settlements.length} payment{settlements.length !== 1 ? "s" : ""} will settle everything.
                  </p>
                )}
              </div>
            </div>

            {/* ── Suggested payment rows ──────────────────────────────────── */}
            <section>
              <h2
                className="text-xs font-semibold uppercase tracking-widest mb-2"
                style={{ color: "var(--sw-ink-soft)" }}
              >
                Suggested payments
              </h2>
              <div className="space-y-3">
                {settlements.map((s, i) => {
                  const fromUser = getUserById(s.from);
                  const toUser = getUserById(s.to);
                  if (!fromUser || !toUser) return null;

                  const iMustPay = s.from === currentUserId;
                  const iGetPaid = s.to === currentUserId;
                  const upiLink = buildUpiLink({
                    payeeVpa: toUser.upiId,
                    payeeName: toUser.name,
                    amountPaise: s.amount,
                    note: `${group.name} settlement`,
                  });

                  return (
                    <div
                      key={i}
                      className="bg-white rounded-2xl overflow-hidden animate-fade-up"
                      style={{
                        boxShadow: "0 2px 8px rgba(0,0,0,0.07)",
                        animationDelay: `${i * 60}ms`,
                        border: (iMustPay || iGetPaid)
                          ? "1.5px solid var(--sw-green)"
                          : "1.5px solid var(--sw-divider)",
                      }}
                    >
                      {/* Payment summary row */}
                      <div className="flex items-center gap-3 px-4 py-3">
                        <Avatar name={fromUser.name} color={fromUser.color} size="sm" />
                        <div className="flex-1">
                          <p className="text-sm font-semibold" style={{ color: "var(--sw-ink)" }}>
                            {s.from === currentUserId ? "You" : fromUser.name}
                            {" "}
                            <span style={{ color: "var(--sw-ink-soft)", fontWeight: 400 }}>pay</span>
                            {" "}
                            {s.to === currentUserId ? "you" : toUser.name}
                          </p>
                          <p
                            className="text-xl font-bold font-money mt-0.5"
                            style={{ color: iMustPay ? "var(--sw-owe)" : "var(--sw-owed)" }}
                          >
                            {formatPaise(s.amount)}
                          </p>
                        </div>
                        <Avatar name={toUser.name} color={toUser.color} size="sm" />
                      </div>

                      {/* Actions */}
                      {iMustPay && (
                        <div
                          className="px-4 pb-4 space-y-2"
                        >
                          {/* UPI deep-link button */}
                          <a
                            href={upiLink}
                            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity active:opacity-80"
                            style={{ background: "var(--sw-green)" }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                              <rect x="2" y="5" width="20" height="14" rx="2"/>
                              <line x1="2" y1="10" x2="22" y2="10"/>
                            </svg>
                            Pay ₹{Math.round(s.amount / 100)} via UPI
                          </a>

                          {/* Desktop UPI ID copy */}
                          <div
                            className="flex items-center gap-2 px-3 py-2 rounded-xl"
                            style={{ background: "var(--sw-bg)" }}
                          >
                            <span className="text-xs flex-1 font-mono truncate" style={{ color: "var(--sw-ink-soft)" }}>
                              {toUser.upiId}
                            </span>
                            <button
                              onClick={() => copyUpiId(i, toUser.upiId)}
                              className="text-xs font-semibold flex-shrink-0 transition-colors"
                              style={{ color: copied[i] ? "var(--sw-green)" : "var(--sw-ink-soft)" }}
                            >
                              {copied[i] ? "Copied ✓" : "Copy"}
                            </button>
                          </div>
                          <p className="text-xs text-center" style={{ color: "var(--sw-ink-soft)" }}>
                            UPI link opens GPay/PhonePe on a phone
                          </p>
                        </div>
                      )}

                      {iGetPaid && (
                        <div className="px-4 pb-4">
                          <div
                            className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
                            style={{ background: "var(--sw-bg)" }}
                          >
                            <span className="text-xs" style={{ color: "var(--sw-ink-soft)" }}>
                              Share your UPI ID:
                            </span>
                            <span className="text-xs font-mono font-semibold flex-1" style={{ color: "var(--sw-ink)" }}>
                              {getUserById(currentUserId)?.upiId}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {/* ── My balance summary ───────────────────────────────────── */}
            {myBalance !== 0 && (
              <div
                className="rounded-2xl px-4 py-3"
                style={{
                  background: myBalance > 0 ? "rgba(28,194,159,0.08)" : "rgba(255,101,47,0.08)",
                  border: `1px solid ${myBalance > 0 ? "rgba(28,194,159,0.3)" : "rgba(255,101,47,0.3)"}`,
                }}
              >
                <p className="text-sm font-semibold" style={{ color: myBalance > 0 ? "var(--sw-owed)" : "var(--sw-owe)" }}>
                  {myBalance > 0
                    ? `You are owed ${formatPaise(myBalance)} overall in this group.`
                    : `You owe ${formatPaise(Math.abs(myBalance))} overall in this group.`}
                </p>
              </div>
            )}
          </>
        )}

        <div className="h-4" />
      </main>
    </AppShell>
  );
}
