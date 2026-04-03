import { clearStoredUser, getAuthHeaders } from './auth';

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  const authHeaders = getAuthHeaders();

  Object.entries(authHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });

  const response = await fetch(input, {
    ...init,
    headers
  });

  if (response.status === 401) {
    clearStoredUser();
  }

  return response;
}
