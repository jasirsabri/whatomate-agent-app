import { apiClient } from './client';
import { getContactTag } from '../config';
import type { ApiEnvelope, Contact, ContactListResponse } from '../types';

// Agents only ever see contacts assigned to them — that filtering happens
// server-side (scopeAssignedContact in Whatomate's source). The tags
// filter additionally scopes this app to just the configured team's
// contacts (default "Customer" — see Settings), since this app is meant
// for one team's use even though the underlying Whatomate account may
// span several departments sharing the same WhatsApp number.
export async function listContacts(page = 1, search = ''): Promise<ContactListResponse> {
  const response = await apiClient.get<ApiEnvelope<ContactListResponse>>('/api/contacts', {
    params: { page, limit: 100, search: search || undefined, tags: getContactTag() },
  });
  return response.data.data;
}

export async function getContact(id: string): Promise<Contact> {
  const response = await apiClient.get<ApiEnvelope<Contact>>(`/api/contacts/${id}`);
  return response.data.data;
}
