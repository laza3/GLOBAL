import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DateString } from '@hmp/shared';
import { api, type Query } from './client';
import { calk } from './calendar';
import { rk } from './rooms';

export type HkStatus = 'dirty' | 'cleaning' | 'clean' | 'inspected';
export type Priority = 'low' | 'normal' | 'high' | 'urgent';
export interface BoardRoom {
  id: string; number: string; name: string | null; floor: number | null; categoryId: string; categoryName: string; housekeepingStatus: HkStatus; displayStatus: string;
  taskId: string | null; taskStatus: string | null; taskPriority: Priority | null; taskType: string | null; assignedId: string | null; assignedName: string | null;
  arrivesToday: boolean; departsToday: boolean; openIssues: number;
}
export interface HkTask {
  id: string; roomId: string; roomNumber: string; floor: number | null; categoryName: string; taskType: string; status: string; priority: Priority; assignedId: string | null; assignedName: string | null;
  dueAt: string | null; startedAt: string | null; completedAt: string | null; notes: string | null; createdAt: string;
}
export interface MaintenanceItem {
  id: string; roomId: string | null; roomNumber: string | null; title: string; description: string | null; priority: Priority; status: 'open' | 'in_progress' | 'resolved' | 'cancelled';
  assignedId: string | null; assignedName: string | null; reportedByName: string | null; allocationId: string | null; costAmount: number | null; reportedAt: string; resolvedAt: string | null;
  blockStartsOn: DateString | null; blockEndsOn: DateString | null;
}

export const hk = {
  all: ['housekeeping'] as const,
  board: (mine: boolean) => ['housekeeping', 'board', mine] as const,
  tasks: (q: Query) => ['housekeeping', 'tasks', q] as const,
  staff: ['housekeeping', 'staff'] as const,
  maintenance: (q: Query) => ['housekeeping', 'maintenance', q] as const,
};

export const useHkBoard = (mine: boolean) =>
  useQuery({ queryKey: hk.board(mine), queryFn: () => api.get<{ today: DateString; rooms: BoardRoom[]; counts: Record<HkStatus, number> }>('/housekeeping/board', { query: { mine: mine ? 'true' : undefined } }), placeholderData: (p) => p, retry: false, refetchInterval: 60_000 });
export const useHkTasks = (q: Query) => useQuery({ queryKey: hk.tasks(q), queryFn: () => api.get<{ items: HkTask[]; total: number; page: number; pageSize: number }>('/housekeeping/tasks', { query: q }), placeholderData: (p) => p, retry: false });
export const useHkStaff = () => useQuery({ queryKey: hk.staff, queryFn: async () => (await api.get<{ staff: Array<{ id: string; name: string; role: string }> }>('/housekeeping/staff')).staff, retry: false });
export const useMaintenance = (q: Query) => useQuery({ queryKey: hk.maintenance(q), queryFn: () => api.get<{ items: MaintenanceItem[]; total: number; page: number; pageSize: number }>('/maintenance', { query: q }), placeholderData: (p) => p, retry: false });

function useAction<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  const refresh = () => Promise.all([hk.all, rk.all, calk.all].map((queryKey) => qc.invalidateQueries({ queryKey })));
  return useMutation({ mutationFn: fn, onSuccess: refresh, onError: () => void qc.invalidateQueries({ queryKey: hk.all }) });
}

export const useTaskStep = () => useAction((i: { id: string; step: 'start' | 'complete' | 'inspect' }) => api.post(`/housekeeping/tasks/${i.id}/${i.step}`));
export const useAssignTask = () => useAction((i: { id: string; assignedId: string | null }) => api.post(`/housekeeping/tasks/${i.id}/assign`, { assignedId: i.assignedId }));
export const useCreateTask = () => useAction((body: Record<string, unknown>) => api.post<{ id: string }>('/housekeeping/tasks', body));
export const useSetRoomHk = () => useAction((i: { roomId: string; status: 'dirty' | 'clean' | 'inspected' }) => api.post(`/housekeeping/rooms/${i.roomId}/status`, { status: i.status }));
export const useReportIssue = () => useAction((i: { taskId: string; body: Record<string, unknown> }) => api.post<{ id: string }>(`/housekeeping/tasks/${i.taskId}/report-issue`, i.body));
export const useCreateMaintenance = () => useAction((body: Record<string, unknown>) => api.post<{ id: string }>('/maintenance', body));
export const usePatchMaintenance = () => useAction((i: { id: string; body: Record<string, unknown> }) => api.patch(`/maintenance/${i.id}`, i.body));

export const TASK_TYPE: Record<string, string> = { checkout_clean: 'Ménage de départ', stayover_clean: 'Ménage de recouche', deep_clean: 'Grand ménage', inspection: 'Inspection' };
export const PRIORITY_LABEL: Record<Priority, string> = { low: 'Basse', normal: 'Normale', high: 'Haute', urgent: 'Urgente' };
export const HK_LABEL: Record<HkStatus, string> = { dirty: 'À nettoyer', cleaning: 'En nettoyage', clean: 'Propre', inspected: 'Contrôlée' };
export const MAINT_STATUS: Record<string, string> = { open: 'Ouverte', in_progress: 'En cours', resolved: 'Résolue', cancelled: 'Annulée' };
