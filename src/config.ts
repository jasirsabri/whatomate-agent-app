import * as SecureStore from 'expo-secure-store';

const SERVER_URL_STORAGE_KEY = 'whatomate_server_url';
const CONTACT_TAG_STORAGE_KEY = 'whatomate_contact_tag';
const TEAM_NAME_STORAGE_KEY = 'whatomate_team_name';
const PUSH_BRIDGE_URL_STORAGE_KEY = 'whatomate_push_bridge_url';

// Used on first launch, and as the "Reset to default" target in Settings.
// Existing Consyst users don't need to configure anything; anyone at a
// different Whatomate org changes this once from the Settings screen.
export const DEFAULT_SERVER_URL = 'https://whatomate.consyst.biz';

// This app is scoped to one team's use — these two defaults are what make
// the conversation list and queue show only that team's data. They're
// plain, editable settings (not baked into the app) specifically so the
// same build works for any team at any Whatomate org, not just Sales here.
export const DEFAULT_CONTACT_TAG = 'Customer';
export const DEFAULT_TEAM_NAME = 'Sales Team';

// The push bridge is a separate, self-hosted service (not part of
// Whatomate itself) — see whatomate-push-bridge/README.md. Configurable
// for the same reason as the other settings: a different org running
// their own bridge shouldn't need a different app build.
export const DEFAULT_PUSH_BRIDGE_URL = 'https://push.consyst.biz';

let serverUrl = DEFAULT_SERVER_URL;
let contactTag = DEFAULT_CONTACT_TAG;
let teamName = DEFAULT_TEAM_NAME;
let pushBridgeUrl = DEFAULT_PUSH_BRIDGE_URL;

/** Strips whitespace and any trailing slash so URLs built by string
 * concatenation elsewhere (`${getServerUrl()}/api/...`) never end up with
 * an accidental double slash. */
export function normalizeServerUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function getServerUrl(): string {
  return serverUrl;
}

export function getWsUrl(): string {
  return `${serverUrl.replace(/^http/, 'ws')}/ws`;
}

export function getContactTag(): string {
  return contactTag;
}

export function getTeamName(): string {
  return teamName;
}

export function getPushBridgeUrl(): string {
  return pushBridgeUrl;
}

/** Called once on app start, before anything else might read these values
 * (see App.tsx) — restores previously-saved settings, if any. */
export async function loadServerUrl(): Promise<void> {
  const [storedUrl, storedTag, storedTeam, storedBridge] = await Promise.all([
    SecureStore.getItemAsync(SERVER_URL_STORAGE_KEY),
    SecureStore.getItemAsync(CONTACT_TAG_STORAGE_KEY),
    SecureStore.getItemAsync(TEAM_NAME_STORAGE_KEY),
    SecureStore.getItemAsync(PUSH_BRIDGE_URL_STORAGE_KEY),
  ]);
  if (storedUrl) serverUrl = storedUrl;
  if (storedTag) contactTag = storedTag;
  if (storedTeam) teamName = storedTeam;
  if (storedBridge) pushBridgeUrl = storedBridge;
}

export async function setServerUrl(url: string): Promise<void> {
  const normalized = normalizeServerUrl(url);
  serverUrl = normalized;
  await SecureStore.setItemAsync(SERVER_URL_STORAGE_KEY, normalized);
}

export async function setContactTag(tag: string): Promise<void> {
  const trimmed = tag.trim();
  contactTag = trimmed;
  await SecureStore.setItemAsync(CONTACT_TAG_STORAGE_KEY, trimmed);
}

export async function setTeamName(name: string): Promise<void> {
  const trimmed = name.trim();
  teamName = trimmed;
  await SecureStore.setItemAsync(TEAM_NAME_STORAGE_KEY, trimmed);
}

export async function setPushBridgeUrl(url: string): Promise<void> {
  const normalized = normalizeServerUrl(url);
  pushBridgeUrl = normalized;
  await SecureStore.setItemAsync(PUSH_BRIDGE_URL_STORAGE_KEY, normalized);
}

export async function resetServerUrlToDefault(): Promise<void> {
  serverUrl = DEFAULT_SERVER_URL;
  await SecureStore.deleteItemAsync(SERVER_URL_STORAGE_KEY);
}

export async function resetContactTagToDefault(): Promise<void> {
  contactTag = DEFAULT_CONTACT_TAG;
  await SecureStore.deleteItemAsync(CONTACT_TAG_STORAGE_KEY);
}

export async function resetTeamNameToDefault(): Promise<void> {
  teamName = DEFAULT_TEAM_NAME;
  await SecureStore.deleteItemAsync(TEAM_NAME_STORAGE_KEY);
}

export async function resetPushBridgeUrlToDefault(): Promise<void> {
  pushBridgeUrl = DEFAULT_PUSH_BRIDGE_URL;
  await SecureStore.deleteItemAsync(PUSH_BRIDGE_URL_STORAGE_KEY);
}
