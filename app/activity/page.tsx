"use client";

import AppShell from "@/components/AppShell";
import { useStore } from "@/store/useStore";
import { formatPaise, categoryEmoji, formatDate } from "@/lib/utils";

export default function ActivityPage() {
  const { expenses, getUserById, currentUserId } = useStore();

  const sorted = [...expenses].sort((a, b) => b.dateISO.localeCompare(a.dateISO));

  return (
    <AppShell>
      <header className="px-4 pt-12 pb-4" style={{ background: "var(--sw-green-deep)" }}>
        <h1 className="text-white text-2xl font-bold">Activity</h1>
      </header>

      <main className="flex-1 px-4 pt-4">
        <div className="space-y-2">
          {sorted.map((expense, i) => {
            const paidById = Object.keys(expense.paidBy)[0];
            const payer = getUserById(paidById);
            const net = (expense.paidBy[currentUserId] ?? 0) - (expense.splitAmong[currentUserId] ?? 0);

            return (
              <div
                key={expense.id}
                className="flex items-center gap-3 bg-white rounded-2xl px-4 py-3 animate-fade-up"
                style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.06)", animationDelay: `${i * 25}ms` }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0" style={{ background: "var(--sw-bg)" }}>
                  {categoryEmoji(expense.category)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate" style={{ color: "var(--sw-ink)" }}>{expense.description}</p>
                  <p className="text-xs" style={{ color: "var(--sw-ink-soft)" }}>
                    {payer ? (paidById === currentUserId ? "You paid" : `${payer.name} paid`) : "?"} · {formatDate(expense.dateISO)}
                    {expense.createdVia === "smartadd" && " · Smart Add"}
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
        <div className="h-4" />
      </main>
    </AppShell>
  );
}
