"use client";

import AppShell from "@/components/AppShell";
import Avatar from "@/components/Avatar";
import { useStore } from "@/store/useStore";

export default function AccountPage() {
  const { users, currentUserId } = useStore();
  const me = users.find((u) => u.id === currentUserId)!;

  return (
    <AppShell>
      <header className="px-4 pt-12 pb-6" style={{ background: "var(--sw-green-deep)" }}>
        <h1 className="text-white text-2xl font-bold mb-4">Account</h1>
        <div className="flex items-center gap-4">
          <Avatar name={me.name} color={me.color} size="lg" />
          <div>
            <p className="text-white text-lg font-bold">{me.name}</p>
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>{me.upiId}</p>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 pt-6">
        <div className="bg-white rounded-2xl divide-y overflow-hidden" style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
          {[
            { label: "UPI ID", value: me.upiId },
            { label: "Phone", value: me.phone ?? "—" },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between px-4 py-3">
              <span className="text-sm" style={{ color: "var(--sw-ink-soft)" }}>{label}</span>
              <span className="text-sm font-medium" style={{ color: "var(--sw-ink)" }}>{value}</span>
            </div>
          ))}
        </div>

        <p className="text-xs text-center mt-8" style={{ color: "var(--sw-ink-soft)" }}>
          AI reads it · your numbers stay exact ✓
        </p>
      </main>
    </AppShell>
  );
}
