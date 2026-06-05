"use client";

import { formatPaise } from "@/lib/utils";
import { Cents } from "@/lib/types";

type Props = {
  amount: Cents;
  /** When true, renders amount from the "you owe" perspective */
  youOwe?: boolean;
};

export default function BalanceBadge({ amount, youOwe }: Props) {
  if (amount === 0) {
    return <span className="text-sm" style={{ color: "var(--sw-ink-soft)" }}>settled up</span>;
  }

  const isOwed = youOwe ? amount < 0 : amount > 0;
  const label = isOwed ? "you are owed" : "you owe";
  const color = isOwed ? "var(--sw-owed)" : "var(--sw-owe)";
  const display = formatPaise(Math.abs(amount));

  return (
    <div className="text-right">
      <div className="text-xs font-money" style={{ color: "var(--sw-ink-soft)" }}>
        {label}
      </div>
      <div className="text-sm font-semibold font-money" style={{ color }}>
        {display}
      </div>
    </div>
  );
}
