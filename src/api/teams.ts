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
  const matches = teams.filter(
    (t) => t.name.trim().toLowerCase() === teamName.trim().toLowerCase()
  );
  // Team names aren't guaranteed unique server-side — no constraint, no
  // duplicate check on creation. Picking the first match blindly would
  // silently scope Queue/assignment to whichever one happened to sort
  // first, with no error shown. Treat an ambiguous name as unresolved
  // (same as "not found" to callers) rather than guess wrong.
  if (matches.length > 1) {
    console.error(
      `[teams] "${teamName}" matches ${matches.length} teams — ambiguous, refusing to guess`,
      matches.map((t) => t.id)
    );
    cachedResolution = { name: teamName, id: null };
    return null;
  }
  const id = matches[0]?.id ?? null;
  cachedResolution = { name: teamName, id };
  return id;
}
