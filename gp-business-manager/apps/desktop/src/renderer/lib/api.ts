import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import type { ApiMethod, ApiParams, ApiResult, Envelope } from '../../main/core/api';

export class ApiError extends Error {
  constructor(public code: string, message: string, public details?: unknown) { super(message); }
}

declare global {
  interface Window {
    gp: {
      call: (method: string, params?: unknown) => Promise<Envelope>;
      system: (op: string, params?: unknown) => Promise<Envelope>;
    };
  }
}

type Listener = (e: ApiError) => void;
const authListeners = new Set<Listener>();
export const onAuthLost = (l: Listener) => { authListeners.add(l); return () => void authListeners.delete(l); };

export async function call<M extends ApiMethod>(method: M, params?: ApiParams<M>): Promise<ApiResult<M>> {
  const r = await window.gp.call(method, params);
  if (!r.ok) {
    const err = new ApiError(r.error.code, r.error.message, r.error.details);
    if (err.code === 'UNAUTHENTICATED') authListeners.forEach((l) => l(err));
    throw err;
  }
  return r.data as ApiResult<M>;
}
export async function callRaw(method: string, params?: unknown) {
  const r = await window.gp.call(method, params);
  if (!r.ok) throw new ApiError(r.error.code, r.error.message, r.error.details);
  return r.data as any;
}
export async function system<T = any>(op: string, params?: unknown): Promise<T> {
  const r = await window.gp.system(op, params);
  if (!r.ok) throw new ApiError(r.error.code, r.error.message);
  return r.data as T;
}

/** Lecture typée : `useQ('products.list', { q })`. */
export function useQ<M extends ApiMethod>(method: M, params?: ApiParams<M>, opts?: Partial<UseQueryOptions<ApiResult<M>, ApiError>>) {
  return useQuery<ApiResult<M>, ApiError>({ queryKey: [method, params ?? null], queryFn: () => call(method, params), ...opts });
}

/** Écriture typée ; invalide toutes les lectures après succès (les données sont locales, donc peu coûteux). */
export function useM<M extends ApiMethod>(method: M, opts?: { onSuccess?: (data: ApiResult<M>) => void; silent?: boolean }) {
  const qc = useQueryClient();
  return useMutation<ApiResult<M>, ApiError, ApiParams<M>>({
    mutationFn: (p) => call(method, p),
    onSuccess: (d) => { qc.invalidateQueries(); opts?.onSuccess?.(d); },
  });
}
