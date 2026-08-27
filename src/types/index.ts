// These shapes are verified directly against Whatomate's Go source
// (internal/handlers/contacts.go, helpers.go) rather than the API docs,
// which turned out not to match this server version in several places
// (envelope key names, field names, request body shape for sending).

export interface Contact {
  id: string;
  phone_number: string;
  name: string;
  profile_name: string;
  avatar_url: string;
  status: string;
  tags: string[];
  last_message_at: string | null;
  last_message_preview: string;
  unread_count: number;
  // omitempty on the Go side — absent entirely when null, not just null.
  assigned_user_id?: string;
  whatsapp_account?: string;
  last_inbound_at?: string;
  service_window_open: boolean;
  marketing_opt_out: boolean;
  created_at: string;
  updated_at: string;
}

// listEnvelope() on the Go side always uses the resource name as the key
// (here "contacts"), not a generic "items".
export interface ContactListResponse {
  contacts: Contact[];
  total: number;
  page: number;
  limit: number;
}

export type MessageDirection = 'incoming' | 'outgoing';

export interface MessageContent {
  // buildMessagesResponse() always wraps text as { body: "..." },
  // regardless of message type.
  body?: string;
}

export interface WhatomateMessage {
  id: string;
  contact_id: string;
  direction: MessageDirection;
  message_type: string;
  content: MessageContent;
  media_url?: string;
  media_mime_type?: string;
  media_filename?: string;
  status: string;
  wamid: string;
  error_message?: string;
  is_reply: boolean;
  reply_to_message_id?: string;
  whatsapp_account?: string;
  created_at: string;
  updated_at: string;
}

// GetMessages() returns "messages" + "has_more", not "items"/"total_pages".
export interface MessageListResponse {
  messages: WhatomateMessage[];
  total: number;
  page?: number;
  limit?: number;
  has_more: boolean;
}

export interface ApiEnvelope<T> {
  status: 'success' | 'error';
  data: T;
  message?: string;
}
