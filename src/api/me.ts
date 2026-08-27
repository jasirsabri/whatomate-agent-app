import { apiClient } from './client';
import type { ApiEnvelope } from '../types';

export interface Permission {
  id: string;
  resource: string;
  action: string;
  description?: string;
}

export interface RoleInfo {
  id: string;
  name: string;
  description?: string;
  is_system: boolean;
  permissions: Permission[];
}

export interface CurrentUser {
  id: string;
  email: string;
  full_name: string;
  role_id?: string;
  role?: RoleInfo;
  is_active: boolean;
  is_available: boolean;
  is_super_admin: boolean;
  organization_id: string;
}

export async function getCurrentUser(): Promise<CurrentUser> {
  const response = await apiClient.get<ApiEnvelope<CurrentUser>>('/api/me');
  return response.data.data;
}

export interface AvailabilityUpdateResult {
  is_available: boolean;
  status: 'available' | 'away';
  transfers_to_queue: number;
}

/** Marking yourself away also automatically returns any conversations
 * currently assigned to you back to the team queue — a real server-side
 * side effect (see UpdateAvailability in Whatomate's source), not just a
 * status flag. */
export async function updateAvailability(isAvailable: boolean): Promise<AvailabilityUpdateResult> {
  const response = await apiClient.put<ApiEnvelope<AvailabilityUpdateResult>>(
    '/api/me/availability',
    { is_available: isAvailable }
  );
  return response.data.data;
}

/** Matches Whatomate's own HasPermission() — super admins bypass the
 * explicit permission list entirely (see internal/handlers/cache.go). */
export function hasPermission(user: CurrentUser, resource: string, action: string): boolean {
  if (user.is_super_admin) return true;
  return (
    user.role?.permissions.some((p) => p.resource === resource && p.action === action) ?? false
  );
}
