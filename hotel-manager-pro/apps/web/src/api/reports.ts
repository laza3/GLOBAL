import { useQuery } from '@tanstack/react-query';
import type { DateString } from '@hmp/shared';
import { api } from './client';

export interface Kpis { roomsSold: number; roomsAvailable: number; revenue: number; occupancyRate: number; adr: number; revpar: number }
export interface DayPoint { date: DateString; roomsSold: number; roomsAvailable: number; revenue: number }
export interface Performance {
  from: DateString; to: DateString; currency: string; advanced: boolean; kpis: Kpis; previous: Kpis | null; daily: DayPoint[]; previousDaily: DayPoint[] | null;
  byCategory: Array<{ id: string; name: string; rooms: number; roomsSold: number; roomsAvailable: number; occupancyRate: number; revenue: number; adr: number }> | null;
  bySource: Array<{ source: string; nights: number; revenue: number; stays: number }> | null;
  topGuests: Array<{ guestId: string; name: string; stays: number; nights: number; revenue: number }> | null;
  charges: Array<{ kind: string; amount: number; tax: number }>;
}
export interface Dashboard {
  today: DateString; currency: string;
  rooms: { total: number; byStatus: Record<string, number>; occupied: number; occupancyRate: number } | null;
  stays: { arrivals: number; arrivalsDone: number; departures: number; departuresDone: number; inHouse: number; overdue: number; upcomingArrivals: Array<{ date: DateString; n: number }>; expiringOptions: number; pendingConfirmation: number } | null;
  money: { collectedToday: number; receivables: number; receivablesFolios: number } | null;
  restaurant: { salesToday: number; openOrders: number } | null;
  housekeeping: { dirty: number; cleaning: number; issues: number } | null;
}

export const usePerformance = (q: { from?: string; to?: string }) => useQuery({ queryKey: ['reports', 'performance', q], queryFn: () => api.get<Performance>('/reports/performance', { query: q }), placeholderData: (p) => p, retry: false });
export const useDashboard = () => useQuery({ queryKey: ['hotel', 'overview', 'dashboard'], queryFn: () => api.get<Dashboard>('/dashboard'), refetchInterval: 60_000, retry: false });
