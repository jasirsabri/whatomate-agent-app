/**
 * Extracts a named cookie's value out of a raw Set-Cookie response header.
 *
 * This only works because React Native's networking layer (unlike a real
 * browser) exposes the Set-Cookie header to JS even for httpOnly cookies —
 * verified directly against this Whatomate instance before building this.
 * Browsers deliberately hide this header from JS as a security measure;
 * that protection doesn't apply here since we're not in a browser and
 * there's no document.cookie/session-fixation risk of the kind it guards
 * against for a single native app reading its own network responses.
 *
 * Whatomate's login/refresh responses set THREE cookies at once
 * (whm_access, whm_refresh, whm_csrf). The HTTP spec sends these as three
 * separate Set-Cookie headers, and a spec-correct client surfaces them to
 * JS as an array — one string per header. In practice, on this
 * Android/React Native combination, they arrive as a single string with
 * all three comma-joined instead. None of these cookies use an Expires
 * attribute (they use Max-Age), which is the only thing that could
 * legitimately put a comma inside one cookie's own attributes — so it's
 * safe to split on comma to separate cookies whenever we get a single
 * string, without risking cutting a real cookie in half.
 */
function splitIntoCookieStrings(setCookieHeader: unknown): string[] {
  if (!setCookieHeader) return [];
  if (Array.isArray(setCookieHeader)) return setCookieHeader;
  return String(setCookieHeader).split(',');
}

export function extractCookieValue(setCookieHeader: unknown, cookieName: string): string | null {
  for (const cookieStr of splitIntoCookieStrings(setCookieHeader)) {
    const firstPart = cookieStr.split(';')[0]?.trim();
    if (!firstPart) continue;
    const eqIndex = firstPart.indexOf('=');
    if (eqIndex === -1) continue;
    const name = firstPart.slice(0, eqIndex).trim();
    if (name === cookieName) {
      return firstPart.slice(eqIndex + 1).trim();
    }
  }
  return null;
}

/** Diagnostic use only — cookie NAMES, never values. */
export function listCookieNames(setCookieHeader: unknown): string[] {
  return splitIntoCookieStrings(setCookieHeader).map((cookieStr) => {
    const firstPart = cookieStr.split(';')[0]?.trim() ?? '';
    const eqIndex = firstPart.indexOf('=');
    return eqIndex === -1 ? '(unparseable)' : firstPart.slice(0, eqIndex).trim();
  });
}
