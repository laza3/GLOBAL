import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export interface StaffMember {
  id: string; userId: string; fullName: string; email: string; jobTitle: string | null; status: 'invited' | 'active' | 'disabled'; roleId: string; roleKey: string; roleName: string;
  lastLoginAt: string | null; mustChangePassword: boolean; createdAt: string;
}
export interface Role { id: string; key: string; name: string; description: string | null; isSystem: boolean; permissions: string[]; members: number }

export const stk = { all: ['staff'] as const, list: ['staff', 'list'] as const, roles: ['staff', 'roles'] as const, password: ['auth', 'password-status'] as const };

export const useStaff = () => useQuery({ queryKey: stk.list, queryFn: async () => (await api.get<{ staff: StaffMember[] }>('/staff')).staff });
export const useRoles = () => useQuery({ queryKey: stk.roles, queryFn: async () => (await api.get<{ roles: Role[] }>('/staff/roles')).roles });
export const usePasswordStatus = () => useQuery({ queryKey: stk.password, queryFn: () => api.get<{ mustChange: boolean }>('/auth/password-status'), staleTime: 60_000, retry: false });

function useAction<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all([stk.all, ['hotel', 'usage'] as const].map((queryKey) => qc.invalidateQueries({ queryKey }))) });
}

export const useCreateStaff = () => useAction((body: { fullName: string; email: string; roleId: string; jobTitle?: string | null }) => api.post<{ membershipId: string; userId: string; email: string; temporaryPassword: string }>('/staff', body));
export const useUpdateStaff = () => useAction((i: { id: string; body: Record<string, unknown> }) => api.patch(`/staff/${i.id}`, i.body));
export const useResetPassword = () => useAction((id: string) => api.post<{ temporaryPassword: string }>(`/staff/${id}/reset-password`));
export const useSaveRole = () => useAction((i: { id?: string; body: Record<string, unknown> }) => (i.id ? api.patch(`/staff/roles/${i.id}`, i.body) : api.post<{ id: string }>('/staff/roles', i.body)));
export const useDeleteRole = () => useAction((id: string) => api.delete(`/staff/roles/${id}`));
