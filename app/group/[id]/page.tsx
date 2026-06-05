"use client";

import { useMemo, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import Avatar from "@/components/Avatar";
import { useStore } from "@/store/useStore";
import {
  computeNetBalances,
  simplifyDebts,
} from "@/lib/ledger";
import { formatPaise, categoryEmoji, formatDate } from "@/lib/utils";

export default function GroupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { groups, expenses, users, currentUserId, getUserById } = useStore();

  const group = groups.find((g) => g.id === id);
  const groupExpenses = useMemo(
    () => expenses.filter((e) => e.groupId === id).sort((a, b) => b.dateISO.localeCompare(a.dateISO)),
    [expenses, id]
  );

  const netBalances = useMemo(() => {
    if (!group) return {};
    return computeNetBalances(groupExpenses, group.memberIds);
  }, [groupExpenses, group]);

  const settlements = useMemo(() => simplifyDebts(netBalances), [netBalances]);

  if (!group) return <div className="p-8 text-center" style={{ color: "var(--sw-ink-soft)" }}>Group not found.</div>;

  const myBalance = netBalances[currentUserId] ?? 0;
  const isOwed = myBalance > 0;

  return (
    <AppShell>
      {/* Header */}
      <header className="px-4 pt-10 pb-5" style={{ background: "var(--sw-green-deep)" }}>
        <button onClick={() => router.back()} className="text-white/60 text-sm mb-3 flex items-center gap-1">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
          Back
        </button>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl" style={{ background: "rgba(255,255,255,0.12)" }}>
            {group.emoji}
          </div>
          <div>
            <h1 className="text-white text-xl font-bold">{group.name}</h1>
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>
              {group.memberIds.length} members · {groupExpenses.length} expenses
            </p>
          </div>
        </div>
        {myBalance !== 0 && (
          <div className="rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.08)" }}>
            <span className="text-sm font-medium" style={{ color: isOwed ? "#6FFFDE" : "#FF8C66" }}>
              {isOwed ? "You are owed " : "You owe "}
              <span className="font-bold">{formatPaise(Math.abs(myBalance))}</span>
              {isOwed ? " in this group" : " in this group"}
            </span>
          </div>
        )}
      </header>

      {/* Action row */}
      <div className="flex gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--sw-divider)", background: "white" }}>
        <Link
          href={`/group/${id}/settle`}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold text-white transition-opacity active:opacity-80"
          style={{ background: "var(--sw-green)" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          Settle up
        </Link>
        {group.type === "trip" && (
          <Link
            href={`/group/${id}/recap`}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold transition-colors border"
            style={{ color: "var(--sw-green)", borderColor: "var(--sw-divider)", background: "white" }}
          >
            Recap
          </Link>
        )}
        <Link
          href={`/group/${id}/mediate`}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold transition-colors border"
          style={{ color: "var(--sw-ink)", borderColor: "var(--sw-divider)", background: "var(--sw-bg)" }}
        >
          Sort it out
        </Link>
      </div>

      <main className="flex-1 px-4 py-4 space-y-4">
        {/* Quick balances */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--sw-ink-soft)" }}>Balances</h2>
          <div className="bg-white rounded-2xl divide-y overflow-hidden" style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
            {group.memberIds.map((memberId) => {
              const user = getUserById(memberId);
              if (!user) return null;
              const bal = netBalances[memberId] ?? 0;
              return (
                <div key={memberId} className="flex items-center gap-3 px-4 py-3">
                  <Avatar name={user.name} color={user.color} size="sm" />
                  <span className="flex-1 text-sm font-medium" style={{ color: "var(--sw-ink)" }}>
                    {memberId === currentUserId ? "You" : user.name}
                  </span>
                  {bal === 0 ? (
                    <span className="text-xs" style={{ color: "var(--sw-ink-soft)" }}>settled</span>
                  ) : (
                    <span className="text-sm font-semibold font-money" style={{ color: bal > 0 ? "var(--sw-owed)" : "var(--sw-owe)" }}>
                      {bal > 0 ? "+" : ""}{formatPaise(bal)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Simplified debts */}
        {settlements.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--sw-ink-soft)" }}>
              Suggested payments
            </h2>
            <div className="space-y-2">
              {settlements.map((s, i) => {
                const from = getUserById(s.from);
                const to = getUserById(s.to);
                if (!from || !to) return null;
                const fromName = s.from === currentUserId ? "You" : from.name;
                const toName = s.to === currentUserId ? "you" : to.name;
                // Show Nudge button when someone owes the current user
                const canNudge = s.to === currentUserId && s.from !== currentUserId;
                return (
                  <div key={i} className="flex items-center gap-3 bg-white rounded-2xl px-4 py-3" style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                    <Avatar name={from.name} color={from.color} size="sm" />
                    <div className="flex-1">
                      <p className="text-sm" style={{ color: "var(--sw-ink)" }}>
                        <span className="font-semibold">{fromName}</span> → <span className="font-semibold">{toName}</span>
                      </p>
                      <p className="text-xs font-money font-semibold" style={{ color: "var(--sw-owe)" }}>
                        {formatPaise(s.amount)}
                      </p>
                    </div>
                    {canNudge && (
                      <Link
                        href={`/friend/${s.from}/nudge`}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold"
                        style={{ background: "var(--sw-bg)", color: "var(--sw-ink-soft)", border: "1px solid var(--sw-divider)" }}
                      >
                        Nudge
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Expense list */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--sw-ink-soft)" }}>Expenses</h2>
          <div className="space-y-2">
            {groupExpenses.map((expense, i) => {
              const paidById = Object.keys(expense.paidBy)[0];
              const payer = getUserById(paidById);
              const myShare = expense.splitAmong[currentUserId] ?? 0;
              const iPaid = expense.paidBy[currentUserId] ?? 0;
              const net = iPaid - myShare;

              return (
                <div
                  key={expense.id}
                  className="flex items-center gap-3 bg-white rounded-2xl px-4 py-3 animate-fade-up"
                  style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.06)", animationDelay: `${i * 30}ms` }}
                >
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0" style={{ background: "var(--sw-bg)" }}>
                    {categoryEmoji(expense.category)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate" style={{ color: "var(--sw-ink)" }}>{expense.description}</p>
                    <div className="flex items-center gap-2">
                      <p className="text-xs" style={{ color: "var(--sw-ink-soft)" }}>
                        {payer ? (paidById === currentUserId ? "You paid" : `${payer.name} paid`) : "?"} · {formatDate(expense.dateISO)}
                      </p>
                      <Link
                        href={`/group/${id}/mediate?q=${encodeURIComponent(`Explain the "${expense.description}" expense`)}`}
                        className="text-xs px-1.5 py-0.5 rounded-full"
                        style={{ color: "var(--sw-ink-soft)", background: "var(--sw-bg)", border: "1px solid var(--sw-divider)", flexShrink: 0 }}
                      >
                        Ask
                      </Link>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-money" style={{ color: "var(--sw-ink-soft)" }}>
                      {formatPaise(expense.amountPaise)}
                    </p>
                    {net !== 0 && (
                      <p className="text-sm font-semibold font-money" style={{ color: net > 0 ? "var(--sw-owed)" : "var(--sw-owe)" }}>
                        {net > 0 ? `+${formatPaise(net)}` : formatPaise(net)}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="h-4" />
      </main>
    </AppShell>
  );
}
