import { apiClient } from './client';
import type { ApiEnvelope } from '../types';

export interface AgentTransfer {
  id: string;
  contact_id: string;
  contact_name: string;
  phone_number: string;
  whatsapp_account: string;
  status: 'active' | 'resumed' | 'expired';
  source: string;
  agent_id?: string;
  agent_name?: string;
  team_id?: string;
  team_name?: string;
  notes: string;
  transferred_at: string;
  // SLA/escalation fields — already returned by the API, previously
  // unused. sla_breached/escalation_level drive the "Needs Attention"
  // section; picked_up_at distinguishes "still waiting" from "already
  // assigned" once the transfer moves out of that section.
  sla_breached: boolean;
  escalation_level: number;
  picked_up_at?: string;
}

interface TransferListResponse {
  transfers: AgentTransfer[];
  total_count: number;
}

/** Lists the queue for a specific team — pass the Sales team's ID (resolved
 * from its name via teams.ts) to see just its unassigned/active transfers.
 * Whatomate already sorts this FIFO (oldest first). */
export async function listTeamQueue(teamId: string): Promise<AgentTransfer[]> {
  const response = await apiClient.get<ApiEnvelope<TransferListResponse>>(
    '/api/chatbot/transfers',
    { params: { status: 'active', team_id: teamId, limit: 100 } }
  );
  return response.data.data.transfers;
}

/** The transfers endpoint has no contact_id filter — only status/team_id/
 * limit/offset — so finding "the active transfer for this one contact"
 * means fetching the team's whole active list and matching client-side.
 * Works for a regular agent too, not just managers: transfer visibility
 * for non-full-access users is already scoped to their own + their
 * team's, so this correctly finds an agent's own assigned contact. */
export async function findActiveTransferForContact(
  teamId: string,
  contactId: string
): Promise<AgentTransfer | null> {
  const transfers = await listTeamQueue(teamId);
  return transfers.find((t) => t.contact_id === contactId) ?? null;
}

/** Requires Transfers: Write — enforced server-side regardless, but the
 * app only shows this action to accounts we've already detected have it. */
export async function assignTransfer(transferId: string, agentId: string): Promise<void> {
  await apiClient.put(`/api/chatbot/transfers/${transferId}/assign`, { agent_id: agentId });
}

/** "Mark resolved" — sets status: "resumed", the only reliable way to get
 * a transfer out of the active queue on demand. Without this, a finished
 * conversation just sits showing as active/in-progress indefinitely
 * unless SLA auto-close happens to be configured and has actually kicked
 * in (see the "resume" endpoint in Whatomate's source — no special
 * permission required beyond being signed in, unlike assign). */
export async function resumeTransfer(transferId: string): Promise<void> {
  await apiClient.put(`/api/chatbot/transfers/${transferId}/resume`);
}
