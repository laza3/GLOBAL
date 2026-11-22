import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Query } from './client';
import { bk } from './billing';
import { resk } from './reservations';

export interface MenuCategory { id: string; name: string; sortOrder: number; isActive: boolean }
export interface Product { id: string; categoryId: string | null; name: string; description: string | null; price: number; taxRuleId: string | null; taxName: string | null; isActive: boolean }
export interface DiningTable { id: string; label: string; area: string | null; seats: number; isActive: boolean; orderId: string | null; orderNumber: string | null; orderTotal: number | null; busy: boolean }
export type OrderStatus = 'open' | 'served' | 'paid' | 'posted_to_room' | 'cancelled';
export interface OrderRow { id: string; number: string; status: OrderStatus; covers: number; total: number; currency: string; openedAt: string; tableLabel: string | null; itemsCount: number }
export interface OrderItem { id: string; productId: string | null; name: string; quantity: number; unitPrice: number; taxAmount: number; status: 'ordered' | 'served' | 'cancelled'; notes: string | null }
export interface OrderDetail {
  id: string; number: string; status: OrderStatus; covers: number; currency: string; subtotal: number; tax: number; total: number; notes: string | null; openedAt: string; closedAt: string | null;
  tableId: string | null; tableLabel: string | null; folioId: string | null; reservationReference: string | null; guestName: string | null; openedByName: string | null; paidWith: string | null; items: OrderItem[];
}
export interface RestaurantSummary { date: string; currency: string; sales: { count: number; total: number; paidAtTable: number; postedToRooms: number }; active: { count: number; total: number }; cancelled: number }

export const rsk = {
  all: ['restaurant'] as const,
  menu: (all: boolean) => ['restaurant', 'menu', all] as const,
  tables: ['restaurant', 'tables'] as const,
  orders: (q: Query) => ['restaurant', 'orders', q] as const,
  order: (id: string) => ['restaurant', 'order', id] as const,
  summary: ['restaurant', 'summary'] as const,
  inHouse: ['restaurant', 'in-house'] as const,
};

export const useMenu = (all = false) => useQuery({ queryKey: rsk.menu(all), queryFn: () => api.get<{ categories: MenuCategory[]; products: Product[] }>('/restaurant/menu', { query: { all: all ? 'true' : undefined } }), retry: false });
export const useTables = () => useQuery({ queryKey: rsk.tables, queryFn: async () => (await api.get<{ tables: DiningTable[] }>('/restaurant/tables')).tables, retry: false });
export const useOrders = (q: Query) => useQuery({ queryKey: rsk.orders(q), queryFn: () => api.get<{ items: OrderRow[]; total: number; page: number; pageSize: number }>('/restaurant/orders', { query: q }), placeholderData: (p) => p, retry: false, refetchInterval: 30_000 });
export const useOrder = (id: string | null) => useQuery({ queryKey: rsk.order(id ?? ''), queryFn: () => api.get<OrderDetail>(`/restaurant/orders/${id}`), enabled: !!id });
export const useRestaurantSummary = () => useQuery({ queryKey: rsk.summary, queryFn: () => api.get<RestaurantSummary>('/restaurant/summary'), retry: false, refetchInterval: 30_000 });
export const useInHouse = () => useQuery({ queryKey: rsk.inHouse, queryFn: async () => (await api.get<{ guests: Array<{ reservationId: string; reference: string; roomNumber: string; guestName: string }> }>('/restaurant/in-house')).guests });

function useAction<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  const refresh = () => Promise.all([rsk.all, bk.all, resk.all, ['hotel', 'overview'] as const].map((queryKey) => qc.invalidateQueries({ queryKey })));
  return useMutation({ mutationFn: fn, onSuccess: refresh, onError: () => void qc.invalidateQueries({ queryKey: rsk.all }) });
}

export const useOpenOrder = () => useAction((i: { body: Record<string, unknown>; idempotencyKey: string }) => api.post<{ id: string; number: string; total: number }>('/restaurant/orders', i.body, { idempotencyKey: i.idempotencyKey }));
export const useAddItems = () => useAction((i: { id: string; items: Array<{ productId: string; quantity: number }> }) => api.post<OrderDetail>(`/restaurant/orders/${i.id}/items`, { items: i.items }));
export const useCancelItem = () => useAction((i: { id: string; itemId: string }) => api.post<OrderDetail>(`/restaurant/orders/${i.id}/items/${i.itemId}/cancel`));
export const useServeOrder = () => useAction((id: string) => api.post<OrderDetail>(`/restaurant/orders/${id}/serve`));
export const useCancelOrder = () => useAction((i: { id: string; reason: string }) => api.post<OrderDetail>(`/restaurant/orders/${i.id}/cancel`, { reason: i.reason }));
export const usePayOrder = () => useAction((i: { id: string; body: Record<string, unknown>; idempotencyKey: string }) => api.post<OrderDetail>(`/restaurant/orders/${i.id}/pay`, i.body, { idempotencyKey: i.idempotencyKey }));
export const usePostToRoom = () => useAction((i: { id: string; reservationId: string }) => api.post<OrderDetail>(`/restaurant/orders/${i.id}/post-to-room`, { reservationId: i.reservationId }));
export const useSaveCategory = () => useAction((i: { id?: string; body: Record<string, unknown> }) => (i.id ? api.patch(`/restaurant/categories/${i.id}`, i.body) : api.post('/restaurant/categories', i.body)));
export const useSaveProduct = () => useAction((i: { id?: string; body: Record<string, unknown> }) => (i.id ? api.patch(`/restaurant/products/${i.id}`, i.body) : api.post('/restaurant/products', i.body)));
export const useSaveTable = () => useAction((i: { id?: string; body: Record<string, unknown> }) => (i.id ? api.patch(`/restaurant/tables/${i.id}`, i.body) : api.post('/restaurant/tables', i.body)));

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: 'warning' | 'info' | 'success' | 'neutral' | 'danger' }> = {
  open: { label: 'En cours', tone: 'warning' }, served: { label: 'Servie', tone: 'info' }, paid: { label: 'Encaissée', tone: 'success' }, posted_to_room: { label: 'Sur la chambre', tone: 'success' }, cancelled: { label: 'Annulée', tone: 'neutral' },
};
