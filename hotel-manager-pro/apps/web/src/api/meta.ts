import { useQuery } from '@tanstack/react-query';
import { api } from './client';

export type AppEnvironment = 'development' | 'staging' | 'production';

/** Environnement de l'instance (public) : sert au bandeau « TEST » affiché hors production. */
export const useEnvironment = () =>
  useQuery({ queryKey: ['meta'], queryFn: () => api.get<{ environment: AppEnvironment }>('/meta'), staleTime: 10 * 60_000, retry: 1 });
