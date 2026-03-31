// AuthContext.tsx
// Provides authentication state to the entire app.
//
// On mount, fetches GET /api/auth/me and GET /api/auth/characters to check
// the active session and load all characters on the account.
//
// Provides actions:
//   login()              — navigates to /api/auth/login (starts SSO flow)
//   logout()             — POSTs to /api/auth/logout, clears local state
//   addCharacter()       — same as login(), but adds a new character to the existing account
//   switchCharacter(id)  — PUTs to /api/auth/switch/:id, switches active character

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';

interface Character {
  characterId:   number;
  characterName: string;
  corporationId?: number;
  scopes?:       string[];
  active?:       boolean;
}

interface AuthContextValue {
  /** The active logged-in character, or null if not authenticated */
  character:       Character | null;
  /** All characters on this account */
  characters:      Character[];
  /** True while the initial /me check is in progress */
  isLoading:       boolean;
  /** Redirect to CCP SSO login page */
  login:           () => void;
  /** Destroy server session and clear local state */
  logout:          () => void;
  /** Add another character to the current account (redirects to SSO) */
  addCharacter:    () => void;
  /** Switch active character (same account) */
  switchCharacter: (characterId: number) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [character, setCharacter] = useState<Character | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch the character list for the current account
  const fetchCharacters = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/characters', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setCharacters(data);
      }
    } catch {
      // ignore
    }
  }, []);

  // Check if we have an active session on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setCharacter(data);
          // Also fetch all characters on this account
          await fetchCharacters();
        }
        // 401 = not logged in, which is fine — character stays null
      } catch {
        // Network error — character stays null
      } finally {
        setIsLoading(false);
      }
    })();
  }, [fetchCharacters]);

  const login = useCallback(() => {
    // Navigate the full page to the backend login route, which redirects to CCP
    window.location.href = '/api/auth/login';
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method:      'POST',
        credentials: 'include',
      });
    } catch {
      // Even if the request fails, clear local state
    }
    setCharacter(null);
    setCharacters([]);
  }, []);

  const addCharacter = useCallback(() => {
    // Same as login — the backend callback sees session.accountId and adds
    // the new character to the existing account
    window.location.href = '/api/auth/login';
  }, []);

  const switchCharacter = useCallback(async (targetId: number) => {
    try {
      const res = await fetch(`/api/auth/switch/${targetId}`, {
        method:      'PUT',
        credentials: 'include',
      });
      if (res.ok) {
        // Refetch /me to get the new active character
        const meRes = await fetch('/api/auth/me', { credentials: 'include' });
        if (meRes.ok) {
          const data = await meRes.json();
          setCharacter(data);
        }
        // Update the characters list (active flags changed)
        await fetchCharacters();
      }
    } catch {
      // ignore
    }
  }, [fetchCharacters]);

  return (
    <AuthContext.Provider value={{
      character, characters, isLoading,
      login, logout, addCharacter, switchCharacter,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Hook to access the auth context. Must be used inside an <AuthProvider>.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
