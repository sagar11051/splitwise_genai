"use client";

import { use, useMemo, useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { useStore } from "@/store/useStore";
import { computeNetBalances, simplifyDebts, groupTotals } from "@/lib/ledger";
import { formatPaise, buildWhatsAppLink, categoryEmoji } from "@/lib/utils";

export default function RecapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { groups, expenses, currentUserId, getUserById } = useStore();

  const group = groups.find((g) => g.id === id);
  const groupExpenses = useMemo(
    () => expenses.filter((e) => e.groupId === id),
    [expenses, id]
  );

  // ── All numbers from Ledger Engine — never from the model ────────────────
  const totals = useMemo(() => groupTotals(groupExpenses), [groupExpenses]);

  const netBalances = useMemo(() => {
    if (!group) return {};
    return computeNetBalances(groupExpenses, group.memberIds);
  }, [groupExpenses, group]);

  const settlements = useMemo(() => simplifyDebts(netBalances), [netBalances]);

  // ── Recap AI state ────────────────────────────────────────────────────────
  const [recap, setRecap] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current || !group || groupExpenses.length === 0) return;
    fetchedRef.current = true;
    setLoading(true);

    const memberNames: Record<string, string> = {};
    group.memberIds.forEach((uid) => {
      const u = getUserById(uid);
      memberNames[uid] = uid === currentUserId ? "You" : (u?.name ?? uid);
    });

    const settlementPayload = settlements.map((s) => ({
      fromName: memberNames[s.from] ?? s.from,
      toName: memberNames[s.to] ?? s.to,
      amountPaise: s.amount,
    }));

    fetch("/api/agent/recap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        groupName: group.name,
        emoji: group.emoji,
        groupType: group.type,
        totalPaise: totals.totalPaise,
        byCategory: totals.byCategory,
        byPayer: totals.byPayer,
        memberNames,
        settlements: settlementPayload,
        expenseCount: groupExpenses.length,
      }),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data) => { if (data?.recap) setRecap(data.recap); })
      .catch((err) => {
        setError(err === 429 ? "AI is busy — showing stats only." : "Couldn't generate recap.");
      })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.id, groupExpenses.length]);

  if (!group) {
    return (
      <AppShell>
        <div className="p-8 text-center" style={{ color: "var(--sw-ink-soft)" }}>Group not found.</div>
      </AppShell>
    );
  }

  // ── Derived stats for the visual strip ───────────────────────────────────
  const topPayer = Object.entries(totals.byPayer).sort((a, b) => b[1] - a[1])[0];
  const topCategory = Object.entries(totals.byCategory).sort((a, b) => b[1] - a[1])[0];
  const topPayerName = topPayer
    ? (topPayer[0] === currentUserId ? "You" : (getUserById(topPayer[0])?.name ?? "?"))
    : null;

  // Build WhatsApp share text from recap + settle-up
  function buildShareText(): string {
    const header = `${group!.emoji} *${group!.name} Recap*\n\n`;
    const recapText = recap ?? `Total spent: ${formatPaise(totals.totalPaise)} across ${groupExpenses.length} expenses.`;
    const settleText = settlements.length === 0
      ? "\n\nEveryone is settled up! 🎉"
      : "\n\nSettle-up:\n" + settlements.map((s) => {
          const from = s.from === currentUserId ? "You" : (getUserById(s.from)?.name ?? s.from);
          const to = s.to === currentUserId ? "you" : (getUserById(s.to)?.name ?? s.to);
          return `• ${from} → ${to}: ${formatPaise(s.amount)}`;
        }).join("\n");
    return header + recapText + settleText + "\n\n_Tracked on Splitwise AI ✨_";
  }

  return (
    <AppShell>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="px-4 pt-10 pb-5" style={{ background: "var(--sw-green-deep)" }}>
        <button onClick={() => router.back()} className="text-white/60 text-sm mb-3 flex items-center gap-1">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-2xl" style={{ background: "rgba(255,255,255,0.12)" }}>
            {group.emoji}
          </div>
          <div>
            <h1 className="text-white text-xl font-bold">Trip Recap</h1>
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>{group.name}</p>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-4 space-y-4">
        {/* ── Stats strip (deterministic — Ledger Engine) ────────────── */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Total spent", value: formatPaise(totals.totalPaise), sub: `${groupExpenses.length} expenses` },
            { label: "Top spender", value: topPayerName ?? "—", sub: topPayer ? formatPaise(topPayer[1]) : "" },
            { label: "Biggest category", value: topCategory ? categoryEmoji(topCategory[0]) + " " + topCategory[0] : "—", sub: topCategory ? formatPaise(topCategory[1]) : "" },
          ].map((stat) => (
            <div key={stat.label} className="bg-white rounded-2xl px-3 py-3 text-center" style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
              <p className="text-xs font-medium mb-1 leading-tight" style={{ color: "var(--sw-ink-soft)" }}>{stat.label}</p>
              <p className="text-sm font-bold font-money truncate" style={{ color: "var(--sw-ink)" }}>{stat.value}</p>
              <p className="text-xs mt-0.5 font-money" style={{ color: "var(--sw-green)" }}>{stat.sub}</p>
            </div>
          ))}
        </div>

        {/* ── AI Recap text ───────────────────────────────────────────── */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{ border: "1px solid var(--sw-divider)", background: "white" }}
        >
          <div style={{ height: "2px", background: "var(--sw-green)" }} />
          <div className="px-4 pt-3 pb-0 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase" style={{ color: "var(--sw-ink-soft)", letterSpacing: "0.08em" }}>
              Recap
            </span>
            <span className="text-xs" style={{ color: "var(--sw-ink-soft)" }}>shareable</span>
          </div>
          <div className="px-4 py-4">
            {loading ? (
              <div className="space-y-2.5">
                {[95, 88, 82, 70].map((w, i) => (
                  <div key={i} className="h-3.5 rounded shimmer" style={{ width: `${w}%` }} />
                ))}
              </div>
            ) : error ? (
              <p className="text-sm" style={{ color: "var(--sw-ink-soft)" }}>{error}</p>
            ) : recap ? (
              <p
                className="text-sm leading-relaxed whitespace-pre-wrap animate-fade-up"
                style={{ color: "var(--sw-ink)" }}
              >
                {recap}
              </p>
            ) : (
              <p className="text-sm" style={{ color: "var(--sw-ink-soft)" }}>
                No expenses yet — nothing to recap.
              </p>
            )}
          </div>
        </div>

        {/* ── Settle-up restatement ───────────────────────────────────── */}
        {settlements.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--sw-ink-soft)" }}>
              Final settle-up
            </h2>
            <div className="space-y-2">
              {settlements.map((s, i) => {
                const from = getUserById(s.from);
                const to = getUserById(s.to);
                if (!from || !to) return null;
                return (
                  <div key={i} className="flex items-center gap-3 bg-white rounded-2xl px-4 py-3 animate-fade-up" style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.06)", animationDelay: `${i * 50}ms` }}>
                    <div className="flex-1">
                      <p className="text-sm font-semibold" style={{ color: "var(--sw-ink)" }}>
                        {s.from === currentUserId ? "You" : from.name}
                        <span className="font-normal mx-1" style={{ color: "var(--sw-ink-soft)" }}>→</span>
                        {s.to === currentUserId ? "you" : to.name}
                      </p>
                    </div>
                    <span className="text-base font-bold font-money" style={{ color: "var(--sw-owe)" }}>
                      {formatPaise(s.amount)}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Share button ────────────────────────────────────────────── */}
        <a
          href={buildWhatsAppLink(undefined, buildShareText())}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2.5 w-full py-4 rounded-2xl font-semibold text-white"
          style={{ background: "#25D366" }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
          </svg>
          Share Recap on WhatsApp
        </a>

        <div className="h-4" />
      </main>
    </AppShell>
  );
}
