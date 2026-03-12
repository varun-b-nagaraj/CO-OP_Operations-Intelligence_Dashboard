import { useEffect, useState } from 'react';

import { can, canonicalizePermissions } from '@/lib/access/engine';
import { PermissionFlag, UserContext } from '@/lib/types';

type AuthMeResponse = {
  ok: boolean;
  user: UserContext | null;
};

let cachedUser: UserContext | null = null;
let loadingPromise: Promise<UserContext | null> | null = null;

async function loadCurrentUser(): Promise<UserContext | null> {
  if (cachedUser) return cachedUser;
  if (loadingPromise) return loadingPromise;

  loadingPromise = fetch('/api/auth/me', {
    method: 'GET',
    cache: 'no-store',
    credentials: 'include'
  })
    .then(async (response) => {
      if (!response.ok) return null;
      const payload = (await response.json()) as AuthMeResponse;
      if (!payload.ok || !payload.user) return null;
      cachedUser = payload.user;
      return payload.user;
    })
    .catch(() => null)
    .finally(() => {
      loadingPromise = null;
    });

  return loadingPromise;
}

function getAnonymousUser(): UserContext {
  return {
    id: null,
    role: null,
    permissions: []
  };
}

export function resetCurrentUserCache() {
  cachedUser = null;
}

export function getCurrentUser(): UserContext {
  if (typeof window === 'undefined') return getAnonymousUser();
  return cachedUser ?? getAnonymousUser();
}

export function hasPermission(flag: PermissionFlag): boolean {
  const user = getCurrentUser();
  return can(flag, canonicalizePermissions(user.permissions));
}

export function useCurrentUser(): { user: UserContext | null; loading: boolean } {
  const [user, setUser] = useState<UserContext | null>(cachedUser);
  const [loading, setLoading] = useState(!cachedUser);

  useEffect(() => {
    let active = true;

    void loadCurrentUser().then((resolvedUser) => {
      if (!active) return;
      setUser(resolvedUser);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, []);

  return { user, loading };
}

export function usePermission(flag: PermissionFlag): boolean {
  const { user } = useCurrentUser();
  return Boolean(user && can(flag, canonicalizePermissions(user.permissions)));
}
