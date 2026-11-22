import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DateString } from '@hmp/shared';
import { api, type Query } from './client';

export interface ExpenseCategory { id: string; name: string; kind: 'expense' | 'overhead'; isActive: boolean; expensesCount: number }
export interface Expense {
  id: string; categoryId: string; categoryName: string; categoryKind: string; description: string; supplier: string | null; amount: number; currency: string; incurredOn: DateString; paidOn: DateString | null; methodCode: string | null;
}
export interface FinanceSummary {
  from: DateString; to: DateString; currency: string;
  collected: { gross: number; refunded: number; net: number; byMethod: Array<{ code: string; label: string | null; collected: number; refunded: number }> };
  expenses: { total: number; paid: number; unpaid: number; byCategory: Array<{ id: string; name: string; kind: string; total: number; paid: number }> };
  cashResult: number; receivables: { total: number; folios: number }; payables: { total: number; count: number };
  daily: Array<{ day: DateString; collected: number; spent: number }>;
}

export const fk = { all: ['finances'] as const, summary: (q: Query) => ['finances', 'summary', q] as const, expenses: (q: Query) => ['finances', 'expenses', q] as const, categories: ['finances', 'categories'] as const };

export const useFinanceSummary = (q: { from?: string; to?: string }) => useQuery({ queryKey: fk.summary(q), queryFn: () => api.get<FinanceSummary>('/finances/summary', { query: q }), placeholderData: (p) => p, retry: false });
export const useExpenses = (q: Query) => useQuery({ queryKey: fk.expenses(q), queryFn: () => api.get<{ items: Expense[]; total: number; page: number; pageSize: number; sum: number; unpaidSum: number }>('/finances/expenses', { query: q }), placeholderData: (p) => p, retry: false });
export const useExpenseCategories = () => useQuery({ queryKey: fk.categories, queryFn: async () => (await api.get<{ categories: ExpenseCategory[] }>('/finances/categories')).categories, retry: false });

function useAction<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: fk.all }) });
}
export const useSaveExpense = () => useAction((i: { id?: string; body: Record<string, unknown> }) => (i.id ? api.patch(`/finances/expenses/${i.id}`, i.body) : api.post<{ id: string }>('/finances/expenses', i.body)));
export const useDeleteExpense = () => useAction((id: string) => api.delete(`/finances/expenses/${id}`));
export const useSaveExpenseCategory = () => useAction((i: { id?: string; body: Record<string, unknown> }) => (i.id ? api.patch(`/finances/categories/${i.id}`, i.body) : api.post<{ id: string }>('/finances/categories', i.body)));
