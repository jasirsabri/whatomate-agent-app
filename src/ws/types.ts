// These match internal/websocket/messages.go and the actual broadcast call
// sites in internal/handlers/messages.go — verified directly against
// Whatomate's source rather than assumed from docs, after the REST API
// docs turned out not to match this server version in several places.

export interface WsEnvelope<T = unknown> {
  type: string;
  payload: T;
}

// Broadcast org-wide (BroadcastToOrg) — the server does NOT scope this to
// the assigned agent, so the client must filter by assigned_user_id itself.
// assigned_user_id is an empty string (not omitted/null) when unassigned.
export interface NewMessagePayload {
  id: string;
  contact_id: string;
  assigned_user_id: string;
  profile_name: string;
  direction: 'incoming' | 'outgoing';
  message_type: string;
  content: { body?: string };
  media_url?: string;
  media_mime_type?: string;
  media_filename?: string;
  status: string;
  wamid: string;
  created_at: string;
  updated_at: string;
  is_reply: boolean;
  reply_to_message_id?: string;
}

// Also broadcast org-wide. No assigned_user_id here — filter by whether
// message_id/contact_id matches something the screen currently has loaded.
export interface StatusUpdatePayload {
  message_id: string;
  contact_id: string;
  status: string;
  wamid?: string;
  error_message?: string;
}
