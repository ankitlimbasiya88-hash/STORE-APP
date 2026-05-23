import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { storage } from "@/src/utils/storage";

export type Role = "admin" | "employee";
export type Session = { token: string; user: { id: string; name: string; role: Role } };

type Ctx = {
  session: Session | null;
  loading: boolean;
  signIn: (name: string, pin: string) => Promise<void>;
  signOut: () => Promise<void>;
  api: <T = any>(path: string, init?: RequestInit) => Promise<T>;
};

const SessionContext = createContext<Ctx | null>(null);
const TOKEN_KEY = "grocery_token";
const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const token = await storage.secureGet<string>(TOKEN_KEY, "");
      if (token) {
        try {
          const res = await fetch(`${BACKEND}/api/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const user = await res.json();
            setSession({ token, user });
          } else {
            await storage.secureRemove(TOKEN_KEY);
          }
        } catch (e) {
          console.warn("Session restore failed", e);
        }
      }
      setLoading(false);
    })();
  }, []);

  const signIn = async (name: string, pin: string) => {
    const res = await fetch(`${BACKEND}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, pin }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Login failed");
    }
    const data = await res.json();
    await storage.secureSet(TOKEN_KEY, data.access_token);
    setSession({ token: data.access_token, user: data.user });
  };

  const signOut = async () => {
    await storage.secureRemove(TOKEN_KEY);
    setSession(null);
  };

  const api = async <T = any,>(path: string, init: RequestInit = {}): Promise<T> => {
    if (!session) throw new Error("Not authenticated");
    const headers = {
      "Content-Type": "application/json",
      ...(init.headers || {}),
      Authorization: `Bearer ${session.token}`,
    };
    const res = await fetch(`${BACKEND}${path}`, { ...init, headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `Request failed: ${res.status}`);
    }
    if (res.status === 204) return {} as T;
    return res.json();
  };

  return (
    <SessionContext.Provider value={{ session, loading, signIn, signOut, api }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}

export function getWsUrl(token: string): string {
  const base = BACKEND || "";
  const wsBase = base.replace(/^http/, "ws");
  return `${wsBase}/api/ws/chat?token=${encodeURIComponent(token)}`;
}
