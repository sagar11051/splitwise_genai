"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { User, Group, Expense } from "@/lib/types";
import { SEED_USERS, SEED_GROUPS, SEED_EXPENSES, CURRENT_USER_ID } from "@/lib/seed";

type Store = {
  users: User[];
  groups: Group[];
  expenses: Expense[];
  currentUserId: string;

  addExpense: (expense: Expense) => void;
  removeExpense: (id: string) => void;
  updateExpense: (id: string, patch: Partial<Omit<Expense, "id">>) => void;
  addGroup: (group: Group) => void;
  getUserById: (id: string) => User | undefined;
  getGroupById: (id: string) => Group | undefined;
  getExpensesForGroup: (groupId: string) => Expense[];
  getExpensesForUsers: (userIds: string[]) => Expense[];
};

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      users: SEED_USERS,
      groups: SEED_GROUPS,
      expenses: SEED_EXPENSES,
      currentUserId: CURRENT_USER_ID,

      addExpense: (expense) =>
        set((s) => ({ expenses: [expense, ...s.expenses] })),

      removeExpense: (id) =>
        set((s) => ({ expenses: s.expenses.filter((e) => e.id !== id) })),

      updateExpense: (id, patch) =>
        set((s) => ({
          expenses: s.expenses.map((e) => (e.id === id ? { ...e, ...patch } : e)),
        })),

      addGroup: (group) =>
        set((s) => ({ groups: [...s.groups, group] })),

      getUserById: (id) => get().users.find((u) => u.id === id),

      getGroupById: (id) => get().groups.find((g) => g.id === id),

      getExpensesForGroup: (groupId) =>
        get().expenses.filter((e) => e.groupId === groupId),

      getExpensesForUsers: (userIds) =>
        get().expenses.filter((e) => {
          const involved = new Set([
            ...Object.keys(e.paidBy),
            ...Object.keys(e.splitAmong),
          ]);
          return userIds.every((id) => involved.has(id));
        }),
    }),
    {
      name: "splitwise-ai-store",
    }
  )
);
