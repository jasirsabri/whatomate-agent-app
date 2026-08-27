import { apiClient } from './client';
import type { ApiEnvelope, MessageListResponse, WhatomateMessage } from '../types';

export async function getMessages(contactId: string, page = 1): Promise<MessageListResponse> {
  const response = await apiClient.get<ApiEnvelope<MessageListResponse>>(
    `/api/contacts/${contactId}/messages`,
    { params: { page, limit: 50 } }
  );
  return response.data.data;
}

export async function sendTextMessage(
  contactId: string,
  text: string
): Promise<WhatomateMessage> {
  // Whatomate's SendMessageRequest wraps body text as content.body, not a
  // bare top-level "text" field.
  const response = await apiClient.post<ApiEnvelope<WhatomateMessage>>(
    `/api/contacts/${contactId}/messages`,
    { type: 'text', content: { body: text } }
  );
  return response.data.data;
}

// Unused for now — GetMessages already marks messages read as a side effect
// of fetching them (see markMessagesAsRead in Whatomate's GetMessages
// handler). Kept correct in case a later phase needs to mark read without
// a full message fetch (e.g. from a push notification tap).
export async function markContactRead(contactId: string): Promise<void> {
  await apiClient.post(`/api/contacts/${contactId}/mark-read`);
}
