import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { storage } from "@/src/utils/storage";

export type Role = "admin" | "employee";
export type User = { id: string; name: string; role: Role; allowed_stores: string[] };
export type Store = { id: string; name: string; created_at: string };
export type Session = { token: string; user: User };

type Ctx = {
  session: Session | null;
  loading: boolean;
  stores: Store[];
  storeId: string | null;
  storeName: string | null;
  setStoreId: (id: string | null) => Promise<void>;
  refreshStores: () => Promise<Store[]>;
  signIn: (name: string, pin: string) => Promise<void>;
  signOut: () => Promise<void>;
  api: <T = any>(path: string, init?: RequestInit) => Promise<T>;
  apiStore: <T = any>(path: string, init?: RequestInit) => Promise<T>; // appends current store_id
};

const SessionContext = createContext<Ctx | null>(null);
const TOKEN_KEY = "grocery_token";
const STORE_KEY = "grocery_store_id";
const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreIdState] = useState<string | null>(null);

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
            const sid = await storage.getItem<string>(STORE_KEY, "");
            if (sid) setStoreIdState(sid);
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

  const refreshStores = useCallback(async (): Promise<Store[]> => {
    if (!session) return [];
    const res = await fetch(`${BACKEND}/api/stores`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (!res.ok) return [];
    const list: Store[] = await res.json();
    setStores(list);
    return list;
  }, [session]);

  useEffect(() => { refreshStores(); }, [refreshStores]);

  const setStoreId = async (id: string | null) => {
    setStoreIdState(id);
    if (id) await storage.setItem(STORE_KEY, id);
    else await storage.removeItem(STORE_KEY);
  };

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
    await storage.removeItem(STORE_KEY);
    setStoreIdState(null);
    setStores([]);
    setSession({ token: data.access_token, user: data.user });
  };

  const signOut = async () => {
    await storage.secureRemove(TOKEN_KEY);
    await storage.removeItem(STORE_KEY);
    setStoreIdState(null);
    setStores([]);
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

  const apiStore = async <T = any,>(path: string, init: RequestInit = {}): Promise<T> => {
    if (!storeId) throw new Error("No store selected");
    const joiner = path.includes("?") ? "&" : "?";
    return api<T>(`${path}${joiner}store_id=${encodeURIComponent(storeId)}`, init);
  };

  const storeName = stores.find((s) => s.id === storeId)?.name || null;

  return (
    <SessionContext.Provider
      value={{ session, loading, stores, storeId, storeName, setStoreId, refreshStores, signIn, signOut, api, apiStore }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}

export function getWsUrl(token: string, storeId: string): string {
  const base = BACKEND || "";
  const wsBase = base.replace(/^http/, "ws");
  return `${wsBase}/api/ws/chat?token=${encodeURIComponent(token)}&store_id=${encodeURIComponent(storeId)}`;
}
