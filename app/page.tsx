"use client";

import { useMemo } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Avatar from "@/components/Avatar";
import BalanceBadge from "@/components/BalanceBadge";
import { useStore } from "@/store/useStore";
import { computeNetBalances, pairwiseBalance } from "@/lib/ledger";
import { formatPaise } from "@/lib/utils";

export default function HomePage() {
  const { users, groups, expenses, currentUserId } = useStore();

  const overallBalance = useMemo(() => {
    const allMembers = [
      ...new Set(
        expenses.flatMap((e) => [
          ...Object.keys(e.paidBy),
          ...Object.keys(e.splitAmong),
        ])
      ),
    ];
    const balances = computeNetBalances(expenses, allMembers);
    return balances[currentUserId] ?? 0;
  }, [expenses, currentUserId]);

  const groupBalances = useMemo(() => {
    return groups.map((g) => {
      const gExpenses = expenses.filter((e) => e.groupId === g.id);
      const balances = computeNetBalances(gExpenses, g.memberIds);
      return { group: g, balance: balances[currentUserId] ?? 0 };
    });
  }, [groups, expenses, currentUserId]);

  const friends = useMemo(() => {
    return users
      .filter((u) => u.id !== currentUserId)
      .map((u) => {
        const shared = expenses.filter(
          (e) =>
            (e.paidBy[currentUserId] !== undefined ||
              e.splitAmong[currentUserId] !== undefined) &&
            (e.paidBy[u.id] !== undefined || e.splitAmong[u.id] !== undefined)
        );
        const balance = shared.length
          ? pairwiseBalance(currentUserId, u.id, shared)
          : 0;
        return { user: u, balance };
      })
      .filter((f) => f.balance !== 0)
      .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  }, [users, expenses, currentUserId]);

  const isOwed = overallBalance > 0;

  const today = useMemo(() => {
    const d = new Date();
    const day = d.toLocaleDateString("en-GB", { weekday: "short" }).toUpperCase();
    const date = d.getDate();
    const month = d.toLocaleDateString("en-GB", { month: "short" }).toUpperCase();
    return `${day} · ${date} ${month}`;
  }, []);

  return (
    <AppShell>
      <header className="px-4 pt-12 pb-6" style={{ background: "var(--sw-green-deep)" }}>
        <h1 className="text-white text-2xl font-bold tracking-tight mb-1">Splitwise</h1>
        <p className="text-xs font-medium mb-4" style={{ color: "rgba(255,255,255,0.35)", letterSpacing: "0.12em" }}>
          {today}
        </p>
        <div className="rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.08)" }}>
          <p className="text-xs font-medium mb-1" style={{ color: "rgba(255,255,255,0.6)" }}>
            Overall balance
          </p>
          {overallBalance === 0 ? (
            <p className="text-white text-lg font-semibold">You&apos;re all settled up 🎉</p>
          ) : (
            <>
              <p className="text-2xl font-bold font-money" style={{ color: isOwed ? "#6FFFDE" : "#FF8C66" }}>
                {formatPaise(Math.abs(overallBalance))}
              </p>
              <p className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.65)" }}>
                {isOwed ? "you are owed in total" : "you owe in total"}
              </p>
            </>
          )}
        </div>
      </header>

      <main className="flex-1 px-4 pt-4 space-y-6">
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--sw-ink-soft)" }}>
            Groups
          </h2>
          <div className="space-y-2">
            {groupBalances.map(({ group, balance }, i) => (
              <Link
                key={group.id}
                href={`/group/${group.id}`}
                className="flex items-center gap-3 bg-white rounded-2xl px-4 py-3 shadow-sm transition-all active:scale-[0.99] animate-fade-up"
                style={{ animationDelay: `${i * 50}ms`, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0" style={{ background: "var(--sw-bg)" }}>
                  {group.emoji}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate" style={{ color: "var(--sw-ink)" }}>{group.name}</p>
                  <p className="text-xs" style={{ color: "var(--sw-ink-soft)" }}>{group.memberIds.length} members</p>
                </div>
                <BalanceBadge amount={balance} />
              </Link>
            ))}
          </div>
        </section>

        {friends.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--sw-ink-soft)" }}>
              Friends
            </h2>
            <div className="space-y-2">
              {friends.map(({ user, balance }, i) => (
                <Link
                  key={user.id}
                  href={`/friend/${user.id}`}
                  className="flex items-center gap-3 bg-white rounded-2xl px-4 py-3 shadow-sm transition-all active:scale-[0.99] animate-fade-up"
                  style={{ animationDelay: `${(groupBalances.length + i) * 50}ms`, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}
                >
                  <Avatar name={user.name} color={user.color} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm" style={{ color: "var(--sw-ink)" }}>{user.name}</p>
                  </div>
                  <BalanceBadge amount={balance} />
                </Link>
              ))}
            </div>
          </section>
        )}

        <div className="h-4" />
      </main>
    </AppShell>
  );
}
