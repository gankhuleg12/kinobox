import { create } from 'zustand';
import { api, refreshSession, tokenStore } from './api';
import { queryClient } from './queryClient';
import type { AuthResponse, SubscriptionSummary, User } from '@/types';

type Status = 'loading' | 'authed' | 'guest';

interface AuthState {
  status: Status;
  user: User | null;
  subscription: SubscriptionSummary | null;
  /** Өөр төхөөрөмжөөс нэвтэрсний улмаас гарсан бол мэдэгдэл */
  revokedMessage: string | null;
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<AuthResponse>;
  register: (name: string, email: string, password: string, locale: string) => Promise<AuthResponse>;
  logout: () => Promise<void>;
  reloadMe: () => Promise<void>;
  setUser: (user: User) => void;
  dismissRevoked: () => void;
}

export const useAuth = create<AuthState>((set, get) => {
  const apply = (data: AuthResponse) => {
    tokenStore.set(data.accessToken);
    set({ status: 'authed', user: data.user, subscription: data.subscription, revokedMessage: null });
  };

  tokenStore.onSessionRevoked((message) => {
    const wasAuthed = get().status === 'authed';
    set({ status: 'guest', user: null, subscription: null, revokedMessage: wasAuthed ? message : null });
    queryClient.removeQueries({ queryKey: ['me'] });
  });

  return {
    status: 'loading',
    user: null,
    subscription: null,
    revokedMessage: null,

    async bootstrap() {
      const data = await refreshSession<AuthResponse>();
      if (data) apply(data);
      else set({ status: 'guest', user: null, subscription: null });
    },

    async login(email, password) {
      const data = await api<AuthResponse>('/auth/login', { method: 'POST', body: { email, password } });
      apply(data);
      queryClient.invalidateQueries({ queryKey: ['me'] });
      return data;
    },

    async register(name, email, password, locale) {
      const data = await api<AuthResponse>('/auth/register', { method: 'POST', body: { name, email, password, locale } });
      apply(data);
      return data;
    },

    async logout() {
      await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
      tokenStore.set(null);
      set({ status: 'guest', user: null, subscription: null });
      queryClient.removeQueries({ queryKey: ['me'] });
      queryClient.removeQueries({ queryKey: ['admin'] });
    },

    async reloadMe() {
      if (get().status !== 'authed') return;
      try {
        const data = await api<{ user: User; subscription: SubscriptionSummary }>('/auth/me');
        set({ user: data.user, subscription: data.subscription });
      } catch {
        /* SESSION_REVOKED-ийг api client зохицуулна */
      }
    },

    setUser: (user) => set({ user }),
    dismissRevoked: () => set({ revokedMessage: null }),
  };
});

export const isStaff = (u: User | null) => u?.role === 'ADMIN' || u?.role === 'EDITOR';

// Tab руу буцаж ирэхэд session шалгана — өөр төхөөрөмжөөс нэвтэрсэн бол шууд мэдэгдэнэ
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void useAuth.getState().reloadMe();
  });
}
