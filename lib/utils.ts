import { Cents } from "./types";

/** Format paise as ₹ string with Indian locale separators. */
export function formatPaise(paise: Cents): string {
  const rupees = paise / 100;
  return (
    "₹" +
    rupees.toLocaleString("en-IN", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })
  );
}

/** Build a UPI deep-link. Opens GPay/PhonePe/Paytm on mobile. */
export function buildUpiLink({
  payeeVpa,
  payeeName,
  amountPaise,
  note,
}: {
  payeeVpa: string;
  payeeName: string;
  amountPaise: Cents;
  note?: string;
}): string {
  const amountRupees = (amountPaise / 100).toFixed(2);
  const params = new URLSearchParams({
    pa: payeeVpa,
    pn: payeeName,
    am: amountRupees,
    cu: "INR",
    tn: note ?? `Payment to ${payeeName}`,
  });
  return `upi://pay?${params.toString()}`;
}

/** Build a WhatsApp deep-link with pre-filled message text. */
export function buildWhatsAppLink(phone: string | undefined, message: string): string {
  const encoded = encodeURIComponent(message);
  if (phone) {
    const digits = phone.replace(/\D/g, "");
    const e164 = digits.startsWith("91") ? digits : `91${digits}`;
    return `https://wa.me/${e164}?text=${encoded}`;
  }
  return `https://wa.me/?text=${encoded}`;
}

/** Initials from a name, max 2 chars. */
export function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/** Generate a unique ID (deterministic enough for client-side usage). */
export function newId(prefix = "id"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

/** Format ISO date as readable string, e.g. "Jan 10" or "Dec 28". */
export function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
}

/** Category to emoji mapping. */
export const CATEGORY_EMOJI: Record<string, string> = {
  food: "🍽️",
  transport: "🚗",
  accommodation: "🏨",
  activity: "🎯",
  groceries: "🛒",
  utilities: "💡",
  rent: "🏠",
  entertainment: "🎬",
  health: "💊",
  shopping: "🛍️",
  other: "📦",
};

export function categoryEmoji(category: string): string {
  return CATEGORY_EMOJI[category] ?? "📦";
}
