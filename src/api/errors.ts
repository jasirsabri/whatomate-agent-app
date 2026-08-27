import { isAxiosError } from 'axios';

/**
 * Turns any caught error into a message that actually says what went
 * wrong, instead of a generic guess. We got burned earlier hiding a real
 * CSRF/response-shape issue behind "could not reach the server" — this is
 * the fix, used everywhere we make a request.
 */
export function describeApiError(err: unknown): string {
  if (isAxiosError(err)) {
    if (err.response) {
      const status = err.response.status;
      if (status === 401) {
        return 'Incorrect email or password.';
      }
      const serverMessage =
        typeof err.response.data?.message === 'string' ? err.response.data.message : null;
      return serverMessage ?? `Server responded with status ${status}.`;
    }
    if (err.request) {
      return `Could not reach the server (${err.code ?? 'no response received'}).`;
    }
    return `Request could not be sent: ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}
