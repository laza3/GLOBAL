import type { AccessDecision, Permission } from '@hmp/shared';
import type { Config } from './config';
import type { Db, Tx } from './db';
import type { SettingsCache } from './lib/settings';

export interface Entitlements {
  source: 'license' | 'subscription' | 'none';
  plan_code: string | null;
  max_rooms: number | null;
  max_users: number | null;
  features: Record<string, boolean>;
  is_perpetual: boolean;
  valid_until: Date | null;
  is_current: boolean;
  subscription_status: string | null;
  license_support_active: boolean | null;
  license_maintenance_until: Date | null;
}

export interface HotelContext {
  sessionTokenHash: string;
  userId: string;
  email: string;
  fullName: string;
  hotelId: string;
  hotelName: string;
  hotelStatus: string;
  membershipId: string;
  roleKey: string;
  roleName: string;
  permissions: string[];
  access: AccessDecision;
  entitlements: Entitlements;
  /** Exécute `fn` dans une transaction liée à l'établissement de l'utilisateur (RLS active). */
  tenant<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

export interface PlatformContext {
  sessionTokenHash: string;
  adminId: string;
  email: string;
  fullName: string;
  /** Transaction sous le rôle plateforme (aucun accès aux données métier d'un hôtel). */
  run<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

export interface HotelAuthOptions {
  permission?: Permission;
  /** Autorisé même en lecture seule (abonnement échu) : facturation SaaS, assistance, profil. */
  lapsedOk?: boolean;
  /** Autorisé même compte suspendu : consultation de son état, assistance, déconnexion. */
  blockedOk?: boolean;
  /** Fonction de la formule exigée (ex. `housekeeping`) : refusée (403 `feature_not_in_plan`) si la formule ne l'inclut pas. */
  feature?: string;
}

export interface AppDeps {
  db: Db;
  config: Config;
  settings: SettingsCache;
  now: () => Date;
}

declare module 'fastify' {
  interface FastifyRequest {
    hotel: HotelContext | null;
    platformAdmin: PlatformContext | null;
  }
  interface FastifyInstance {
    deps: AppDeps;
  }
}
