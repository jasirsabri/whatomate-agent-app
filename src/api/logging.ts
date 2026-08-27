import { isAxiosError } from 'axios';

/**
 * Logs an error with just enough detail to debug from (status, URL,
 * method, response body, message/code), while deliberately never printing
 * the request/response headers — which, for this app, means never
 * printing the X-API-Key header. Logging a raw AxiosError directly
 * (console.error('...', err)) puts the whole request config, including
 * headers, into whatever is reading the console; this exists so no call
 * site has to remember to avoid that by hand.
 *
 * Use this everywhere an error might be an AxiosError (i.e. it came from
 * an apiClient call). Plain, non-network errors are still logged in full
 * since they don't carry credentials.
 */
export function logApiError(label: string, err: unknown): void {
  if (isAxiosError(err)) {
    console.error(label, {
      message: err.message,
      code: err.code,
      method: err.config?.method,
      url: err.config?.url,
      status: err.response?.status,
      responseData: err.response?.data,
    });
    return;
  }
  console.error(label, err);
}
