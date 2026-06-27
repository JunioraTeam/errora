"use client";

import * as React from "react";
import { api } from "@/lib/api";
import { tokenStore } from "@/lib/token-store";
import type { AuthResponse, Tokens, User } from "@/lib/types";

type AuthContextValue = {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  setSession: (res: AuthResponse) => void;
  setTokens: (tokens: Tokens) => Promise<void>;
  signOut: () => void;
  refreshUser: () => Promise<void>;
};

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  const loadMe = React.useCallback(async () => {
    if (!tokenStore.get()) {
      setUser(null);
      setIsLoading(false);
      return;
    }
    try {
      const me = await api.auth.me();
      setUser(me);
    } catch {
      tokenStore.clear();
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadMe();
  }, [loadMe]);

  const setSession = React.useCallback((res: AuthResponse) => {
    tokenStore.set(res.tokens);
    setUser(res.user);
    setIsLoading(false);
  }, []);

  const setTokens = React.useCallback(
    async (tokens: Tokens) => {
      tokenStore.set(tokens);
      await loadMe();
    },
    [loadMe],
  );

  const signOut = React.useCallback(() => {
    // Best-effort server-side revoke, then clear locally regardless.
    api.auth.logout().catch(() => {});
    tokenStore.clear();
    setUser(null);
  }, []);

  const value = React.useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isAuthenticated: !!user,
      setSession,
      setTokens,
      signOut,
      refreshUser: loadMe,
    }),
    [user, isLoading, setSession, setTokens, signOut, loadMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
