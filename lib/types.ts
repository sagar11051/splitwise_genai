export type Cents = number; // integer paise (₹0.01 = 1 paise)

export type User = {
  id: string;
  name: string;
  upiId: string;
  phone?: string;
  color: string; // hex for avatar background
};

export type GroupType = "trip" | "flat" | "other";

export type Group = {
  id: string;
  name: string;
  type: GroupType;
  emoji: string;
  memberIds: string[];
};

export type Expense = {
  id: string;
  groupId?: string;
  description: string;
  amountPaise: Cents;
  paidBy: Record<string, Cents>; // userId -> paise paid
  splitAmong: Record<string, Cents>; // userId -> paise share
  category: string;
  dateISO: string;
  createdVia: "manual" | "smartadd";
  notes?: string;
};

export type Settlement = {
  from: string; // userId
  to: string; // userId
  amount: Cents;
};

export type ExpenseDraft = {
  description: string | null;
  amountPaise: Cents | null;
  paidBy: string | null; // userId
  splitAmong: string[]; // userIds
  splitAmounts: Record<string, Cents> | null; // null = equal split
  category: string | null;
  notes: string | null;
};
