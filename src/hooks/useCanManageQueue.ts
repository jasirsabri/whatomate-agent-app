import { useEffect, useState } from 'react';
import { getCurrentUser, hasPermission } from '../api/me';
import { logApiError } from '../api/logging';

/**
 * Fetches the current user once and checks for Transfers: Write —
 * matching Whatomate's own permission check for who can assign a
 * queued conversation to a specific agent (see AssignAgentTransfer in
 * Whatomate's source). Defaults to false while loading or on error,
 * since hiding the Queue entry point is the safe failure mode here.
 */
export function useCanManageQueue(): boolean {
  const [canManage, setCanManage] = useState(false);

  useEffect(() => {
    let isActive = true;
    (async () => {
      try {
        const user = await getCurrentUser();
        if (isActive) {
          setCanManage(hasPermission(user, 'transfers', 'write'));
        }
      } catch (err) {
        logApiError('Failed to check queue permission:', err);
      }
    })();
    return () => {
      isActive = false;
    };
  }, []);

  return canManage;
}
