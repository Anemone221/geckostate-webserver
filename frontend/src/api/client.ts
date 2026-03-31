// client.ts
// Base HTTP helper used by all API hooks.
//
// In development, Vite proxies /api → http://localhost:3000, so no CORS.
// In production, the backend serves the frontend from the same origin, also no CORS.
// Either way, we always use a relative path like '/api/settings'.

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!res.ok) {
    // Try to get the error message from the backend response body
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}
