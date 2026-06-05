import {
  computeNetBalances,
  simplifyDebts,
  pairwiseBalance,
  groupTotals,
  formatPaise,
} from "../lib/ledger";
import { Expense } from "../lib/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────
const r = (rupees: number) => Math.round(rupees * 100);

function makeExpense(
  id: string,
  paidBy: Record<string, number>,
  splitAmong: Record<string, number>,
  amountPaise?: number
): Expense {
  const totalPaid = Object.values(paidBy).reduce((a, b) => a + b, 0);
  return {
    id,
    description: "Test expense",
    amountPaise: amountPaise ?? totalPaid,
    paidBy,
    splitAmong,
    category: "food",
    dateISO: "2025-01-01",
    createdVia: "manual",
  };
}

// ─── computeNetBalances ───────────────────────────────────────────────────────

describe("computeNetBalances", () => {
  test("simple 2-person even split: payer is owed half", () => {
    const expenses = [
      makeExpense("e1", { alice: r(200) }, { alice: r(100), bob: r(100) }),
    ];
    const result = computeNetBalances(expenses, ["alice", "bob"]);
    expect(result.alice).toBe(r(100));  // paid 200, owes 100 → +100
    expect(result.bob).toBe(-r(100));   // paid 0, owes 100 → -100
  });

  test("3-person split: balances sum to zero", () => {
    const expenses = [
      makeExpense(
        "e1",
        { alice: r(300) },
        { alice: r(100), bob: r(100), carol: r(100) }
      ),
    ];
    const balances = computeNetBalances(expenses, ["alice", "bob", "carol"]);
    const sum = Object.values(balances).reduce((a, b) => a + b, 0);
    expect(sum).toBe(0);
    expect(balances.alice).toBe(r(200));
    expect(balances.bob).toBe(-r(100));
    expect(balances.carol).toBe(-r(100));
  });

  test("multiple expenses accumulate correctly", () => {
    const expenses = [
      makeExpense("e1", { alice: r(600) }, { alice: r(300), bob: r(300) }),
      makeExpense("e2", { bob: r(200) }, { alice: r(100), bob: r(100) }),
    ];
    const balances = computeNetBalances(expenses, ["alice", "bob"]);
    // alice: paid 600, owes 400 → +200
    // bob: paid 200, owes 400 → -200
    expect(balances.alice).toBe(r(200));
    expect(balances.bob).toBe(-r(200));
  });

  test("members with no expenses get zero balance", () => {
    const balances = computeNetBalances([], ["alice", "bob"]);
    expect(balances.alice).toBe(0);
    expect(balances.bob).toBe(0);
  });

  test("unequal split: paise values respected", () => {
    // Rahul pays 1200 for dinner; Rahul 300, others 300 each (3 people)
    const expenses = [
      makeExpense(
        "e1",
        { rahul: r(1200) },
        { rahul: r(300), priya: r(600), sara: r(300) }
      ),
    ];
    const balances = computeNetBalances(expenses, ["rahul", "priya", "sara"]);
    expect(balances.rahul).toBe(r(900));   // paid 1200, owes 300
    expect(balances.priya).toBe(-r(600));
    expect(balances.sara).toBe(-r(300));
    const sum = Object.values(balances).reduce((a, b) => a + b, 0);
    expect(sum).toBe(0);
  });
});

// ─── simplifyDebts ────────────────────────────────────────────────────────────

describe("simplifyDebts", () => {
  test("2-person: single settlement", () => {
    const settlements = simplifyDebts({ alice: r(100), bob: -r(100) });
    expect(settlements).toHaveLength(1);
    expect(settlements[0]).toMatchObject({
      from: "bob",
      to: "alice",
      amount: r(100),
    });
  });

  test("3-person chain: simplifies to fewer transactions", () => {
    // alice=+200, bob=-100, carol=-100
    const settlements = simplifyDebts({
      alice: r(200),
      bob: -r(100),
      carol: -r(100),
    });
    expect(settlements).toHaveLength(2);
    const total = settlements.reduce((s, t) => s + t.amount, 0);
    expect(total).toBe(r(200));
  });

  test("all zero balances: no settlements", () => {
    const settlements = simplifyDebts({ alice: 0, bob: 0, carol: 0 });
    expect(settlements).toHaveLength(0);
  });

  test("settlement amounts sum equals total owed", () => {
    const balances = {
      a: r(500),
      b: -r(200),
      c: r(100),
      d: -r(400),
    };
    const settlements = simplifyDebts(balances);
    const totalSettled = settlements
      .filter((s) => s.amount > 0)
      .reduce((sum, s) => sum + s.amount, 0);
    // Total credits = 600, total debits = 600
    expect(totalSettled).toBe(r(600));
  });

  test("greedy: matches biggest creditor with biggest debtor first", () => {
    const balances = {
      rich: r(300),
      medium: r(100),
      poor1: -r(200),
      poor2: -r(200),
    };
    const settlements = simplifyDebts(balances);
    expect(settlements.length).toBeLessThanOrEqual(4);
    // All debts resolved
    const netAfter: Record<string, number> = { ...balances };
    for (const s of settlements) {
      netAfter[s.from] += s.amount;
      netAfter[s.to] -= s.amount;
    }
    for (const bal of Object.values(netAfter)) {
      expect(Math.abs(bal)).toBe(0);
    }
  });
});

// ─── pairwiseBalance ──────────────────────────────────────────────────────────

describe("pairwiseBalance", () => {
  test("A paid for both: A is owed by B", () => {
    const expenses = [
      makeExpense("e1", { alice: r(200) }, { alice: r(100), bob: r(100) }),
    ];
    const bal = pairwiseBalance("alice", "bob", expenses);
    expect(bal).toBe(r(100)); // alice is owed 100
  });

  test("symmetric: B's perspective is negative of A's", () => {
    const expenses = [
      makeExpense("e1", { alice: r(200) }, { alice: r(100), bob: r(100) }),
    ];
    const balAB = pairwiseBalance("alice", "bob", expenses);
    const balBA = pairwiseBalance("bob", "alice", expenses);
    expect(balAB).toBe(-balBA);
  });

  test("both paid, net is correct", () => {
    const expenses = [
      makeExpense("e1", { alice: r(200) }, { alice: r(100), bob: r(100) }),
      makeExpense("e2", { bob: r(100) }, { alice: r(50), bob: r(50) }),
    ];
    // alice: paid 200, owes 150 → +50
    // bob: paid 100, owes 150 → -50
    const bal = pairwiseBalance("alice", "bob", expenses);
    expect(bal).toBe(r(50));
  });
});

// ─── groupTotals ─────────────────────────────────────────────────────────────

describe("groupTotals", () => {
  test("sums total correctly", () => {
    const expenses = [
      makeExpense("e1", { alice: r(300) }, { alice: r(150), bob: r(150) }, r(300)),
      makeExpense("e2", { bob: r(200) }, { alice: r(100), bob: r(100) }, r(200)),
    ];
    const totals = groupTotals(expenses);
    expect(totals.totalPaise).toBe(r(500));
  });

  test("byPayer aggregates per user", () => {
    const expenses = [
      makeExpense("e1", { alice: r(300) }, { alice: r(150), bob: r(150) }, r(300)),
      makeExpense("e2", { alice: r(200) }, { alice: r(100), bob: r(100) }, r(200)),
    ];
    const totals = groupTotals(expenses);
    expect(totals.byPayer.alice).toBe(r(500));
    expect(totals.byPayer.bob).toBeUndefined();
  });

  test("empty expenses: all zeros", () => {
    const totals = groupTotals([]);
    expect(totals.totalPaise).toBe(0);
    expect(Object.keys(totals.byCategory)).toHaveLength(0);
    expect(Object.keys(totals.byPayer)).toHaveLength(0);
  });
});

// ─── formatPaise ─────────────────────────────────────────────────────────────

describe("formatPaise", () => {
  test("whole rupees", () => {
    expect(formatPaise(r(1000))).toBe("₹1,000");
  });

  test("zero", () => {
    expect(formatPaise(0)).toBe("₹0");
  });

  test("fractional rupees", () => {
    expect(formatPaise(150)).toBe("₹1.5");
  });
});
