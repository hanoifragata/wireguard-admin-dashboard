import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  accessToken: string | null;
  username: string | null;
  role: 'admin' | 'operator' | null;
  isAuthenticated: boolean;
  setToken: (
    token: string,
    username: string,
    role: 'admin' | 'operator'
  ) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      username: null,
      role: null,
      isAuthenticated: false,

      setToken: (token, username, role) =>
        set({ accessToken: token, username, role, isAuthenticated: true }),

      logout: () =>
        set({ accessToken: null, username: null, role: null, isAuthenticated: false }),
    }),
    {
      name: 'wg-manager-auth',
      partialize: (state) => ({
        // Don't persist the access token itself (short-lived); rely on cookie refresh
        username: state.username,
        role: state.role,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
