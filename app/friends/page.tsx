"use client";

import { useMemo } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Avatar from "@/components/Avatar";
import BalanceBadge from "@/components/BalanceBadge";
import { useStore } from "@/store/useStore";
import { pairwiseBalance } from "@/lib/ledger";

export default function FriendsPage() {
  const { users, expenses, currentUserId } = useStore();

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
      .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  }, [users, expenses, currentUserId]);

  return (
    <AppShell>
      <header className="px-4 pt-12 pb-4" style={{ background: "var(--sw-green-deep)" }}>
        <h1 className="text-white text-2xl font-bold">Friends</h1>
      </header>

      <main className="flex-1 px-4 pt-4">
        <div className="space-y-2">
          {friends.map(({ user, balance }, i) => (
            <Link
              key={user.id}
              href={`/friend/${user.id}`}
              className="flex items-center gap-3 bg-white rounded-2xl px-4 py-3 shadow-sm animate-fade-up transition-all active:scale-[0.99]"
              style={{ animationDelay: `${i * 40}ms`, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}
            >
              <Avatar name={user.name} color={user.color} />
              <div className="flex-1">
                <p className="font-semibold text-sm" style={{ color: "var(--sw-ink)" }}>{user.name}</p>
                <p className="text-xs" style={{ color: "var(--sw-ink-soft)" }}>{user.upiId}</p>
              </div>
              <BalanceBadge amount={balance} />
            </Link>
          ))}
        </div>
        <div className="h-4" />
      </main>
    </AppShell>
  );
}
