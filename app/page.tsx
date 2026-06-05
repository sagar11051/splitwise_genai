"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import Avatar from "@/components/Avatar";
import BalanceBadge from "@/components/BalanceBadge";
import { useStore } from "@/store/useStore";
import { computeNetBalances, pairwiseBalance } from "@/lib/ledger";
import { formatPaise } from "@/lib/utils";

// ── Command bar ───────────────────────────────────────────────────────────────
type CmdState = "idle" | "loading" | "error";

const EXAMPLES = ["add 500 lunch with Rahul", "nudge Sara", "settle up Goa", "recap Goa trip"];

function CommandBar({
  groups,
  members,
}: {
  groups: { id: string; name: string; type: string }[];
  members: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [state, setState] = useState<CmdState>("idle");
  const [hint, setHint] = useState<string | null>(null);
  const [exampleIdx, setExampleIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cycle through example placeholders
  useEffect(() => {
    const t = setInterval(() => setExampleIdx((i) => (i + 1) % EXAMPLES.length), 3000);
    return () => clearInterval(t);
  }, []);

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const cmd = text.trim();
    if (!cmd || state === "loading") return;

    setState("loading");
    setHint(null);

    try {
      // Route always returns 200 — errors come back as intent:"unknown"
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: cmd, groups, members }),
      });

      if (!res.ok) {
        // Network-level failure only
        setHint("Connection error. Try again.");
        setState("error");
        return;
      }

      const data = await res.json();

      switch (data.intent) {
        case "add":
          // Takes to Add Expense screen — user selects group + confirms there
          router.push(`/add?q=${encodeURIComponent(data.text ?? cmd)}`);
          setText("");
          break;

        case "nudge":
          if (data.memberId) {
            // Takes to Nudge Composer — user picks tone + sends there
            router.push(`/friend/${data.memberId}/nudge`);
            setText("");
          } else {
            setHint("Who do you want to nudge? Try 'nudge Rahul' or 'remind Sara'.");
            setState("error");
          }
          break;

        case "settle":
          router.push(`/group/${data.groupId ?? groups[0]?.id}/settle`);
          setText("");
          break;

        case "recap":
          router.push(`/group/${data.groupId ?? groups[0]?.id}/recap`);
          setText("");
          break;

        case "mediate": {
          const gid = data.groupId ?? groups[0]?.id;
          router.push(`/group/${gid}/mediate?q=${encodeURIComponent(data.question ?? cmd)}`);
          setText("");
          break;
        }

        default: // "unknown"
          setHint(
            data.reply ??
            "Try: 'add 500 biryani', 'nudge Rahul', 'settle up Flat 304', 'recap Goa trip'."
          );
          setState("error");
      }
    } catch {
      setHint("Connection error. Try again.");
      setState("error");
    } finally {
      setState((s) => (s === "loading" ? "idle" : s));
    }
  }

  const isLoading = state === "loading";

  return (
    <div>
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 bg-white rounded-2xl px-4 py-3 transition-all"
        style={{
          boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
          border: isLoading
            ? "1.5px solid var(--sw-green)"
            : state === "error"
            ? "1.5px solid var(--sw-owe)"
            : "1.5px solid var(--sw-divider)",
          transition: "border-color 0.2s",
        }}
      >
        {/* Command icon */}
        <div className="flex-shrink-0" style={{ color: isLoading ? "var(--sw-green)" : "var(--sw-ink-soft)" }}>
          {isLoading ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ animation: "spin 1s linear infinite" }}>
              <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 17 10 11 4 5"/>
              <line x1="12" y1="19" x2="20" y2="19"/>
            </svg>
          )}
        </div>

        {/* Input */}
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => { setText(e.target.value); if (state === "error") setState("idle"); setHint(null); }}
          placeholder={`Try: "${EXAMPLES[exampleIdx]}"`}
          disabled={isLoading}
          className="flex-1 text-sm bg-transparent focus:outline-none"
          style={{ color: "var(--sw-ink)", caretColor: "var(--sw-green)" }}
          autoComplete="off"
          spellCheck={false}
        />

        {/* Submit button */}
        <button
          type="submit"
          disabled={!text.trim() || isLoading}
          className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-all disabled:opacity-0"
          style={{ background: "var(--sw-green)" }}
          aria-label="Run command"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"/>
            <polyline points="12 5 19 12 12 19"/>
          </svg>
        </button>
      </form>

      {/* Hint / error */}
      {hint && (
        <p
          className="text-xs mt-1.5 px-1 animate-fade-up"
          style={{ color: state === "error" ? "var(--sw-owe)" : "var(--sw-ink-soft)", animationDuration: "0.2s" }}
        >
          {hint}
        </p>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Dashboard page ────────────────────────────────────────────────────────────
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

  // Command bar payload — members = non-me users
  const cmdGroups = useMemo(
    () => groups.map((g) => ({ id: g.id, name: g.name, type: g.type })),
    [groups]
  );
  const cmdMembers = useMemo(
    () =>
      users
        .filter((u) => u.id !== currentUserId)
        .map((u) => ({ id: u.id, name: u.name })),
    [users, currentUserId]
  );

  return (
    <AppShell>
      {/* ── Header ─────────────────────────────────────────────────────── */}
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

      <main className="flex-1 px-4 pt-4 space-y-5">
        {/* ── Ask Splitwise command bar ───────────────────────────────── */}
        <CommandBar groups={cmdGroups} members={cmdMembers} />

        {/* ── Groups ─────────────────────────────────────────────────── */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--sw-ink-soft)" }}>
            Groups
          </h2>
          <div className="space-y-2">
            {groupBalances.map(({ group, balance }, i) => (
              <Link
                key={group.id}
                href={`/group/${group.id}`}
                className="flex items-center gap-3 bg-white rounded-2xl px-4 py-3 transition-all active:scale-[0.99] animate-fade-up"
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

        {/* ── Friends ────────────────────────────────────────────────── */}
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
                  className="flex items-center gap-3 bg-white rounded-2xl px-4 py-3 transition-all active:scale-[0.99] animate-fade-up"
                  style={{
                    animationDelay: `${(groupBalances.length + i) * 50}ms`,
                    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                  }}
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
