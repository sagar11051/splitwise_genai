"use client";

import BottomNav from "./BottomNav";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    // On desktop the body bg is #E8EAED (set in globals.css @media md),
    // creating the "phone on a desk" visual. On mobile it's full-bleed.
    <div className="relative min-h-full flex justify-center" style={{ background: "var(--sw-bg)" }}>
      <div
        className="w-full max-w-[430px] min-h-screen flex flex-col pb-20 relative"
        style={{
          background: "var(--sw-bg)",
          // Subtle frame shadow visible on desktop when content is narrower than viewport
          boxShadow: "0 0 0 1px rgba(0,0,0,0.04), 0 8px 40px rgba(0,0,0,0.08)",
        }}
      >
        {children}
      </div>
      <BottomNav />
    </div>
  );
}
