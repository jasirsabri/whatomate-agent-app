/**
 * Decodes (does NOT verify) a JWT's payload. We only use this to read our
 * own user_id out of the short-lived ws-token we already legitimately
 * received from Whatomate over HTTPS — never for anything security-
 * relevant, so skipping signature verification client-side is fine here.
 */
export interface DecodedJwtClaims {
  user_id?: string;
  organization_id?: string;
  email?: string;
  exp?: number;
  [key: string]: unknown;
}

export function decodeJwtPayload(token: string): DecodedJwtClaims | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) base64 += '=';

    const json = atob(base64);
    return JSON.parse(json) as DecodedJwtClaims;
  } catch {
    return null;
  }
}
