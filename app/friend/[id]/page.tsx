"use client";

import { useMemo, use } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import Avatar from "@/components/Avatar";
import { useStore } from "@/store/useStore";
import { pairwiseBalance } from "@/lib/ledger";
import { formatPaise, categoryEmoji, formatDate, buildWhatsAppLink } from "@/lib/utils";

export default function FriendDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { users, expenses, currentUserId, getUserById } = useStore();

  const friend = users.find((u) => u.id === id);

  const sharedExpenses = useMemo(
    () =>
      expenses
        .filter(
          (e) =>
            (e.paidBy[currentUserId] !== undefined ||
              e.splitAmong[currentUserId] !== undefined) &&
            (e.paidBy[id] !== undefined || e.splitAmong[id] !== undefined)
        )
        .sort((a, b) => b.dateISO.localeCompare(a.dateISO)),
    [expenses, currentUserId, id]
  );

  const balance = useMemo(
    () => pairwiseBalance(currentUserId, id, sharedExpenses),
    [currentUserId, id, sharedExpenses]
  );

  if (!friend)
    return (
      <div className="p-8 text-center" style={{ color: "var(--sw-ink-soft)" }}>
        Friend not found.
      </div>
    );

  const isOwed = balance > 0;

  return (
    <AppShell>
      {/* Header */}
      <header className="px-4 pt-10 pb-6" style={{ background: "var(--sw-green-deep)" }}>
        <button onClick={() => router.back()} className="text-white/60 text-sm mb-3 flex items-center gap-1">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
          Back
        </button>
        <div className="flex items-center gap-4 mb-4">
          <Avatar name={friend.name} color={friend.color} size="lg" />
          <div>
            <h1 className="text-white text-xl font-bold">{friend.name}</h1>
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>{friend.upiId}</p>
          </div>
        </div>

        {balance !== 0 ? (
          <div className="rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.08)" }}>
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.7)" }}>
              {isOwed ? `${friend.name} owes you` : `You owe ${friend.name}`}
            </p>
            <p className="text-2xl font-bold font-money" style={{ color: isOwed ? "#6FFFDE" : "#FF8C66" }}>
              {formatPaise(Math.abs(balance))}
            </p>
          </div>
        ) : (
          <div className="rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.08)" }}>
            <p className="text-white font-semibold">All settled up 🎉</p>
          </div>
        )}
      </header>

      {/* Action row */}
      <div className="flex gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--sw-divider)", background: "white" }}>
        <a
          href={`/friend/${id}/nudge`}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold text-white"
          style={{ background: "var(--sw-green)" }}
        >
          ✉️ Nudge
        </a>
        {balance < 0 && (
          <a
            href={`upi://pay?pa=${friend.upiId}&pn=${encodeURIComponent(friend.name)}&am=${(Math.abs(balance) / 100).toFixed(2)}&cu=INR&tn=Splitwise+settlement`}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold border"
            style={{ color: "var(--sw-ink)", borderColor: "var(--sw-divider)", background: "var(--sw-bg)" }}
          >
            💳 Pay via UPI
          </a>
        )}
      </div>

      <main className="flex-1 px-4 py-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--sw-ink-soft)" }}>
          Shared expenses
        </h2>
        {sharedExpenses.length === 0 ? (
          <p className="text-sm text-center py-10" style={{ color: "var(--sw-ink-soft)" }}>No shared expenses yet.</p>
        ) : (
          <div className="space-y-2">
            {sharedExpenses.map((expense, i) => {
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
                    {expense.createdVia === "smartadd" ? "✨" : categoryEmoji(expense.category)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate" style={{ color: "var(--sw-ink)" }}>{expense.description}</p>
                    <p className="text-xs" style={{ color: "var(--sw-ink-soft)" }}>
                      {payer ? (paidById === currentUserId ? "You paid" : `${payer.name} paid`) : "?"} · {formatDate(expense.dateISO)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-money" style={{ color: "var(--sw-ink-soft)" }}>{formatPaise(expense.amountPaise)}</p>
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
        )}
        <div className="h-4" />
      </main>
    </AppShell>
  );
}
