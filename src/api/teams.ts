import { apiClient } from './client';
import type { ApiEnvelope } from '../types';

export interface Team {
  id: string;
  name: string;
  is_active: boolean;
}

interface TeamListResponse {
  teams: Team[];
  total: number;
}

export async function listTeams(): Promise<Team[]> {
  const response = await apiClient.get<ApiEnvelope<TeamListResponse>>('/api/teams');
  return response.data.data.teams;
}

export interface TeamMember {
  id: string; // team-membership record id — NOT the user's id
  user_id: string; // use this one for assignment calls
  full_name: string;
  email: string;
  role: 'manager' | 'agent';
  is_available: boolean;
  last_assigned_at?: string;
}

interface TeamMembersResponse {
  members: TeamMember[];
}

/** Requires Teams: Read, or being a member of this team yourself — same
 * access rule Whatomate's own ListTeamMembers enforces. */
export async function listTeamMembers(teamId: string): Promise<TeamMember[]> {
  const response = await apiClient.get<ApiEnvelope<TeamMembersResponse>>(
    `/api/teams/${teamId}/members`
  );
  return response.data.data.members;
}

// Session-scoped cache — Queue (on every focus) and Chat's transfer
// lookup (on every chat opened) both resolve the same configured team
// name repeatedly; there's no need to re-fetch the full team list each
// time. Busts itself naturally if the configured name changes (compared
// exactly below); goes stale only if the team itself is renamed
// server-side mid-session, an acceptable tradeoff for avoiding a redundant
// API call on every chat/queue open.
let cachedResolution: { name: string; id: string | null } | null = null;

/** Settings stores a human-readable team name, not a UUID — this resolves
 * it at the point of use. Requires Teams: Read (or being a member of the
 * team) to see it in the list at all. */
export async function resolveTeamIdByName(teamName: string): Promise<string | null> {
  if (cachedResolution && cachedResolution.name === teamName) {
    return cachedResolution.id;
  }
  const teams = await listTeams();
  const match = teams.find((t) => t.name.trim().toLowerCase() === teamName.trim().toLowerCase());
  const id = match?.id ?? null;
  cachedResolution = { name: teamName, id };
  return id;
}
