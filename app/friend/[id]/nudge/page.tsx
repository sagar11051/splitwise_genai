"use client";

import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import Avatar from "@/components/Avatar";
import { useStore } from "@/store/useStore";
import { pairwiseBalance } from "@/lib/ledger";
import { formatPaise, buildUpiLink, buildWhatsAppLink } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────
type Tone = "gentle" | "friendly" | "funny" | "firm";
type DraftState = "idle" | "loading" | "done" | "error";

const TONES: { value: Tone; label: string; emoji: string; color: string }[] = [
  { value: "gentle",   label: "Gentle",   emoji: "🙏", color: "#1CC29F" },
  { value: "friendly", label: "Friendly", emoji: "😊", color: "#16B6C4" },
  { value: "funny",    label: "Funny",    emoji: "😄", color: "#F59E0B" },
  { value: "firm",     label: "Firm",     emoji: "💼", color: "#6366F1" },
];

export default function NudgePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { users, expenses, currentUserId, getUserById } = useStore();

  const friend = users.find((u) => u.id === id);
  const currentUser = getUserById(currentUserId);

  const sharedExpenses = useMemo(
    () =>
      expenses.filter(
        (e) =>
          (e.paidBy[currentUserId] !== undefined || e.splitAmong[currentUserId] !== undefined) &&
          (e.paidBy[id] !== undefined || e.splitAmong[id] !== undefined)
      ),
    [expenses, currentUserId, id]
  );

  const balance = useMemo(
    () => pairwiseBalance(currentUserId, id, sharedExpenses),
    [currentUserId, id, sharedExpenses]
  );

  // Positive = friend owes me, negative = I owe friend
  const amountOwed = balance; // from current user's perspective
  const friendOwesMe = amountOwed > 0;
  const amountRupees = Math.abs(amountOwed) / 100;

  // ── Nudge state ───────────────────────────────────────────────────────────
  const [tone, setTone] = useState<Tone>("friendly");
  const [draftState, setDraftState] = useState<DraftState>("idle");
  const [messages, setMessages] = useState<string[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [editedMsg, setEditedMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleDraft(selectedTone: Tone) {
    if (Math.abs(amountOwed) === 0 || !friend) return;

    setDraftState("loading");
    setMessages([]);
    setSelectedIdx(null);
    setEditedMsg("");
    setErrorMsg("");

    const context = sharedExpenses.length > 0
      ? `Shared expenses: ${sharedExpenses.slice(0, 3).map((e) => e.description).join(", ")}`
      : "General shared expenses";

    try {
      const res = await fetch("/api/agent/nudge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          debtorName: friendOwesMe ? friend.name : (currentUser?.name ?? "me"),
          creditorName: friendOwesMe ? (currentUser?.name ?? "me") : friend.name,
          amountRupees,
          context,
          tone: selectedTone,
        }),
      });

      if (res.status === 429) {
        setErrorMsg("AI is busy — try again in a moment.");
        setDraftState("error");
        return;
      }
      if (!res.ok) {
        setErrorMsg("Couldn't draft messages. Try again.");
        setDraftState("error");
        return;
      }

      const data = await res.json();
      setMessages(data.messages ?? []);
      setDraftState("done");
    } catch {
      setErrorMsg("Connection error. Try again.");
      setDraftState("error");
    }
  }

  function selectMessage(idx: number) {
    setSelectedIdx(idx);
    // Replace {{UPI_LINK}} placeholder with the real UPI link in the editable area
    const upiLink = friendOwesMe && currentUser
      ? buildUpiLink({
          payeeVpa: currentUser.upiId,
          payeeName: currentUser.name,
          amountPaise: Math.abs(amountOwed),
          note: "Splitwise settlement",
        })
      : "";
    const msg = messages[idx].replace("{{UPI_LINK}}", upiLink ? `Pay here: ${upiLink}` : "");
    setEditedMsg(msg);
  }

  function handleSendWhatsApp() {
    if (!editedMsg.trim() || !friend) return;
    const waLink = buildWhatsAppLink(friend.phone, editedMsg);
    window.open(waLink, "_blank");
  }

  if (!friend) {
    return (
      <AppShell>
        <div className="p-8 text-center" style={{ color: "var(--sw-ink-soft)" }}>Friend not found.</div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="px-4 pt-10 pb-5" style={{ background: "var(--sw-green-deep)" }}>
        <button
          onClick={() => router.back()}
          className="text-white/60 text-sm mb-3 flex items-center gap-1"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <div className="flex items-center gap-4">
          <Avatar name={friend.name} color={friend.color} size="lg" />
          <div>
            <h1 className="text-white text-xl font-bold">Nudge {friend.name}</h1>
            {amountOwed !== 0 && (
              <p className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.7)" }}>
                {friendOwesMe
                  ? `${friend.name} owes you `
                  : `You owe ${friend.name} `}
                <span className="font-bold" style={{ color: friendOwesMe ? "#6FFFDE" : "#FF8C66" }}>
                  {formatPaise(Math.abs(amountOwed))}
                </span>
              </p>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-5 space-y-5">
        {amountOwed === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-5xl mb-4">✅</div>
            <p className="text-lg font-bold" style={{ color: "var(--sw-ink)" }}>All settled up!</p>
            <p className="text-sm mt-1" style={{ color: "var(--sw-ink-soft)" }}>
              Nothing to nudge {friend.name} about right now.
            </p>
          </div>
        ) : (
          <>
            {/* ── Tone selector ──────────────────────────────────────────── */}
            <section>
              <p
                className="text-xs font-semibold uppercase tracking-widest mb-3"
                style={{ color: "var(--sw-ink-soft)" }}
              >
                Pick a tone
              </p>
              <div className="grid grid-cols-4 gap-2">
                {TONES.map((t) => {
                  const isSelected = tone === t.value;
                  return (
                    <button
                      key={t.value}
                      onClick={() => {
                        setTone(t.value);
                        handleDraft(t.value);
                      }}
                      className="relative flex flex-col items-center gap-1.5 py-3 rounded-2xl font-medium text-xs transition-all active:scale-95"
                      style={{
                        background: isSelected ? t.color : "white",
                        color: isSelected ? "white" : "var(--sw-ink)",
                        border: isSelected ? `1.5px solid ${t.color}` : "1.5px solid var(--sw-divider)",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <span className="text-xl leading-none">{t.emoji}</span>
                      <span className="font-semibold">{t.label}</span>
                      {isSelected && (
                        <span
                          className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full flex items-center justify-center"
                          style={{ background: "white", boxShadow: `0 0 0 1.5px ${t.color}` }}
                        >
                          <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                            <polyline points="2 6 5 9 10 3" stroke={t.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* ── Loading shimmer ─────────────────────────────────────────── */}
            {draftState === "loading" && (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="rounded-2xl p-4"
                    style={{ animationDelay: `${i * 80}ms` }}
                  >
                    <div className="space-y-2">
                      <div className="h-3.5 rounded shimmer" style={{ width: "90%" }} />
                      <div className="h-3.5 rounded shimmer" style={{ width: "80%" }} />
                      <div className="h-3.5 rounded shimmer" style={{ width: "60%" }} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Error ──────────────────────────────────────────────────── */}
            {draftState === "error" && (
              <div
                className="rounded-2xl px-4 py-3 text-sm"
                style={{ background: "rgba(255,101,47,0.08)", color: "var(--sw-owe)" }}
              >
                {errorMsg}
              </div>
            )}

            {/* ── Message options ─────────────────────────────────────────── */}
            {draftState === "done" && messages.length > 0 && (
              <section>
                <p
                  className="text-xs font-semibold uppercase tracking-widest mb-3"
                  style={{ color: "var(--sw-ink-soft)" }}
                >
                  Pick a message
                </p>
                <div className="space-y-3">
                  {messages.map((msg, i) => {
                    const isSelected = selectedIdx === i;
                    const preview = msg.replace("{{UPI_LINK}}", "[UPI link]");
                    return (
                      <button
                        key={i}
                        onClick={() => selectMessage(i)}
                        className="w-full text-left rounded-2xl p-4 transition-all animate-fade-up"
                        style={{
                          animationDelay: `${i * 80}ms`,
                          background: "white",
                          border: isSelected
                            ? "1.5px solid var(--sw-green)"
                            : "1px solid var(--sw-divider)",
                          boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                          transition: "border-color 0.15s ease",
                        }}
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                            style={{
                              background: isSelected ? "var(--sw-green)" : "var(--sw-bg)",
                              border: isSelected ? "none" : "1.5px solid var(--sw-divider)",
                            }}
                          >
                            {isSelected && (
                              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                                <polyline points="2 6 5 9 10 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            )}
                          </div>
                          <p
                            className="text-sm leading-relaxed whitespace-pre-wrap"
                            style={{ color: "var(--sw-ink)" }}
                          >
                            {preview}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* ── Edit + Send ─────────────────────────────────────────────── */}
            {selectedIdx !== null && (
              <section className="animate-fade-up" style={{ animationDuration: "0.25s" }}>
                <div className="flex items-center justify-between mb-2">
                  <p
                    className="text-xs font-semibold uppercase tracking-widest"
                    style={{ color: "var(--sw-ink-soft)" }}
                  >
                    Edit before sending
                  </p>
                  <span className="text-xs" style={{ color: "var(--sw-ink-soft)" }}>
                    UPI link included ✓
                  </span>
                </div>
                <textarea
                  value={editedMsg}
                  onChange={(e) => setEditedMsg(e.target.value)}
                  rows={6}
                  className="w-full rounded-2xl border px-4 py-3 text-sm leading-relaxed resize-none focus:outline-none"
                  style={{
                    borderColor: "var(--sw-divider)",
                    color: "var(--sw-ink)",
                    background: "white",
                  }}
                />

                {/* WhatsApp send button */}
                <button
                  onClick={handleSendWhatsApp}
                  disabled={!editedMsg.trim()}
                  className="mt-3 w-full flex items-center justify-center gap-2.5 py-4 rounded-2xl font-semibold text-white transition-all disabled:opacity-40 active:scale-[0.98]"
                  style={{ background: "#25D366" }}
                >
                  {/* WhatsApp icon */}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
                  </svg>
                  Send on WhatsApp
                </button>

                {!friend.phone && (
                  <p className="text-xs text-center mt-2" style={{ color: "var(--sw-ink-soft)" }}>
                    No phone saved — WhatsApp will open without a pre-filled contact.
                  </p>
                )}
              </section>
            )}

            {/* ── Idle state hint ─────────────────────────────────────────── */}
            {draftState === "idle" && (
              <div
                className="rounded-2xl p-4"
                style={{ border: "1px solid var(--sw-divider)", background: "white" }}
              >
                <p className="text-sm" style={{ color: "var(--sw-ink)" }}>
                  Tap a tone above to draft messages instantly.
                </p>
                <p className="text-xs mt-1" style={{ color: "var(--sw-ink-soft)" }}>
                  The UPI payment link is embedded automatically.
                </p>
              </div>
            )}
          </>
        )}

        <div className="h-4" />
      </main>
    </AppShell>
  );
}
