import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuth } from './auth';
import type { AccessInfo, Category, HomeData, MovieCard, MovieDetail, Paged, PaymentStatus, Plan, Reel } from '@/types';

export const useHome = () => useQuery({ queryKey: ['home'], queryFn: ({ signal }) => api<HomeData>('/catalog/home', { signal }) });

export const useCategories = () =>
  useQuery({ queryKey: ['categories'], queryFn: ({ signal }) => api<Category[]>('/catalog/categories', { signal }), staleTime: 5 * 60_000 });

export const usePlans = () => useQuery({ queryKey: ['plans'], queryFn: ({ signal }) => api<Plan[]>('/catalog/plans', { signal }), staleTime: 5 * 60_000 });

export const usePublicConfig = () =>
  useQuery({
    queryKey: ['config'],
    queryFn: ({ signal }) => api<Record<string, string | number | boolean>>('/catalog/config', { signal }),
    staleTime: 5 * 60_000,
  });

export const useMovie = (slug: string | undefined) =>
  useQuery({ queryKey: ['movie', slug], queryFn: ({ signal }) => api<MovieDetail>(`/catalog/movies/${slug}`, { signal }), enabled: Boolean(slug) });

export function useMovieList(params: { category?: string; sort: string }) {
  return useInfiniteQuery({
    queryKey: ['movies', params],
    queryFn: ({ pageParam, signal }) => api<Paged<MovieCard>>('/catalog/movies', { query: { ...params, page: pageParam, limit: 24 }, signal }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.pages ? last.page + 1 : undefined),
  });
}

/** Reels: cursor-тэй infinite feed */
export const useReels = () =>
  useInfiniteQuery({
    queryKey: ['reels'],
    queryFn: ({ pageParam, signal }) => api<{ items: Reel[]; nextCursor: string | null }>('/catalog/reels', { query: { cursor: pageParam, limit: 8 }, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export const useReel = (id: string | undefined) =>
  useQuery({ queryKey: ['reel', id], queryFn: ({ signal }) => api<Reel>(`/catalog/reels/${id}`, { signal }), enabled: Boolean(id) });

export const useSearch = (q: string) =>
  useQuery({
    queryKey: ['search', q],
    queryFn: ({ signal }) => api<{ items: MovieCard[] }>('/catalog/search', { query: { q }, signal }),
    enabled: q.trim().length > 0,
    placeholderData: (prev) => prev,
  });

// ── Нэвтэрсэн хэрэглэгчийн
const useAuthed = () => useAuth((s) => s.status === 'authed');

export const useAccess = (movieId: string | undefined) => {
  const authed = useAuthed();
  return useQuery({
    queryKey: ['me', 'access', movieId],
    queryFn: ({ signal }) => api<AccessInfo>(`/me/movies/${movieId}/access`, { signal }),
    enabled: authed && Boolean(movieId),
    staleTime: 15_000,
  });
};

export const useContinueWatching = () => {
  const authed = useAuthed();
  return useQuery({
    queryKey: ['me', 'continue'],
    queryFn: ({ signal }) => api<MovieCard[]>('/me/continue-watching', { signal }),
    enabled: authed,
  });
};

export interface Library {
  subscription: { active: boolean; planNameMn: string | null; planNameEn: string | null; endsAt: string | null };
  subscriptions: { id: string; status: string; startsAt: string; endsAt: string; plan: { code: string; nameMn: string; nameEn: string } }[];
  rentals: { id: string; startsAt: string; expiresAt: string; active: boolean; movie: MovieCard }[];
}
export const useLibrary = () => {
  const authed = useAuthed();
  return useQuery({ queryKey: ['me', 'library'], queryFn: ({ signal }) => api<Library>('/me/library', { signal }), enabled: authed });
};

export interface MyPayment {
  id: string;
  type: 'RENTAL' | 'SUBSCRIPTION';
  amount: number;
  status: PaymentStatus;
  createdAt: string;
  paidAt: string | null;
  movie: { title: string; slug: string } | null;
  plan: { nameMn: string; nameEn: string } | null;
}
export const useMyPayments = (page: number) => {
  const authed = useAuthed();
  return useQuery({
    queryKey: ['me', 'payments', page],
    queryFn: ({ signal }) => api<Paged<MyPayment>>('/me/payments', { query: { page }, signal }),
    enabled: authed,
  });
};

export interface MySession {
  id: string;
  deviceName: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
  current: boolean;
}
export const useMySessions = () => {
  const authed = useAuthed();
  return useQuery({ queryKey: ['me', 'sessions'], queryFn: ({ signal }) => api<MySession[]>('/me/sessions', { signal }), enabled: authed });
};
