export interface AuthUser {
  id: string;
  email: string;
  name: string;
  sessionToken: string;
}

const USER_STORAGE_KEY = 'vibe_user';

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.id === 'string' &&
      typeof parsed.email === 'string' &&
      typeof parsed.name === 'string' &&
      typeof parsed.sessionToken === 'string'
    ) {
      return parsed as AuthUser;
    }
  } catch (error) {
    console.warn('[auth] Failed to parse stored user:', error);
  }

  localStorage.removeItem(USER_STORAGE_KEY);
  return null;
}

export function storeUser(user: AuthUser) {
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
}

export function clearStoredUser() {
  localStorage.removeItem(USER_STORAGE_KEY);
}

export function getAuthHeaders(): Record<string, string> {
  const user = getStoredUser();
  if (!user?.sessionToken) return {};

  return {
    Authorization: `Bearer ${user.sessionToken}`
  };
}
