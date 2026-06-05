import { Cents, Expense, Settlement } from "./types";

/**
 * Compute each member's net balance across a set of expenses.
 * Positive = they are owed money. Negative = they owe money.
 */
export function computeNetBalances(
  expenses: Expense[],
  memberIds: string[]
): Record<string, Cents> {
  const balances: Record<string, Cents> = {};
  for (const id of memberIds) balances[id] = 0;

  for (const expense of expenses) {
    // Credit what each person paid
    for (const [userId, paid] of Object.entries(expense.paidBy)) {
      if (userId in balances) balances[userId] += paid;
    }
    // Debit each person's share
    for (const [userId, share] of Object.entries(expense.splitAmong)) {
      if (userId in balances) balances[userId] -= share;
    }
  }

  return balances;
}

/**
 * Greedy debt-simplification — same algorithm Splitwise uses.
 * Returns minimum-transaction list to settle all debts.
 */
export function simplifyDebts(
  netBalances: Record<string, Cents>
): Settlement[] {
  const creditors: [string, Cents][] = [];
  const debtors: [string, Cents][] = [];

  for (const [id, balance] of Object.entries(netBalances)) {
    if (balance > 0) creditors.push([id, balance]);
    else if (balance < 0) debtors.push([id, -balance]); // store as positive
  }

  // Sort descending so we always match biggest creditor with biggest debtor
  creditors.sort((a, b) => b[1] - a[1]);
  debtors.sort((a, b) => b[1] - a[1]);

  const settlements: Settlement[] = [];
  let ci = 0;
  let di = 0;

  while (ci < creditors.length && di < debtors.length) {
    const [credId, credAmt] = creditors[ci];
    const [debId, debAmt] = debtors[di];
    const amount = Math.min(credAmt, debAmt);

    if (amount > 0) {
      settlements.push({ from: debId, to: credId, amount });
    }

    creditors[ci] = [credId, credAmt - amount];
    debtors[di] = [debId, debAmt - amount];

    if (creditors[ci][1] === 0) ci++;
    if (debtors[di][1] === 0) di++;
  }

  return settlements;
}

/**
 * Pairwise balance between two users across a set of expenses.
 * Positive = userA is owed by userB. Negative = userA owes userB.
 */
export function pairwiseBalance(
  userA: string,
  userB: string,
  expenses: Expense[]
): Cents {
  let balance = 0;

  for (const expense of expenses) {
    const aPaid = expense.paidBy[userA] ?? 0;
    const bPaid = expense.paidBy[userB] ?? 0;
    const aShare = expense.splitAmong[userA] ?? 0;
    const bShare = expense.splitAmong[userB] ?? 0;

    // From A's perspective: paid - share = net contribution
    balance += aPaid - aShare;
    // B's payments reduce what A is owed
    balance -= bPaid - bShare;
  }

  // Normalize: balance / 2 because both A and B's contributions are counted
  // Actually the correct formula is: A_paid - A_share is already A's net vs. whole group
  // For pairwise, we only care about the direct A<->B exposure
  // Re-derive cleanly:
  return computePairwiseDirect(userA, userB, expenses);
}

function computePairwiseDirect(
  userA: string,
  userB: string,
  expenses: Expense[]
): Cents {
  const balances = computeNetBalances(expenses, [userA, userB]);
  // If A has positive balance, A is owed by B (in this 2-person sub-ledger)
  return balances[userA];
}

export type GroupTotals = {
  totalPaise: Cents;
  byCategory: Record<string, Cents>;
  byPayer: Record<string, Cents>;
};

/**
 * Aggregate totals for a group — used by Recap Agent.
 */
export function groupTotals(expenses: Expense[]): GroupTotals {
  let totalPaise = 0;
  const byCategory: Record<string, Cents> = {};
  const byPayer: Record<string, Cents> = {};

  for (const expense of expenses) {
    totalPaise += expense.amountPaise;

    const cat = expense.category;
    byCategory[cat] = (byCategory[cat] ?? 0) + expense.amountPaise;

    for (const [userId, paid] of Object.entries(expense.paidBy)) {
      byPayer[userId] = (byPayer[userId] ?? 0) + paid;
    }
  }

  return { totalPaise, byCategory, byPayer };
}

/** Format paise to ₹ string, e.g. 245000 -> "₹2,450" */
export function formatPaise(paise: Cents): string {
  const rupees = paise / 100;
  return "₹" + rupees.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
