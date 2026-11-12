export type Role = 'USER' | 'EDITOR' | 'ADMIN';
export type AccessType = 'SUBSCRIPTION' | 'RENT_ONLY' | 'FREE';
export type MovieKind = 'MOVIE' | 'SERIES';

export interface ImageSet {
  src: string;
  srcSet: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatarUrl: string | null;
  locale: string;
  hasPassword: boolean;
  googleLinked: boolean;
  createdAt: string;
}

export interface SubscriptionSummary {
  active: boolean;
  planCode: string | null;
  planNameMn: string | null;
  planNameEn: string | null;
  endsAt: string | null;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
  subscription: SubscriptionSummary;
  kickedDevices?: number;
}

export interface Category {
  id: number;
  slug: string;
  nameMn: string;
  nameEn: string;
}

export interface MovieCard {
  id: string;
  kind: MovieKind;
  slug: string;
  title: string;
  titleEn: string | null;
  releaseYear: number | null;
  durationSec: number | null;
  ageRating: string | null;
  imdbRating: number | null;
  accessType: AccessType;
  posterColor: string | null;
  poster: ImageSet | null;
  backdrop: ImageSet | null;
  publishedAt: string | null;
  progress?: { positionSec: number; durationSec: number | null };
}

export interface FeaturedMovie extends MovieCard {
  description: string;
  descriptionEn: string | null;
  trailerUrl: string | null;
}

export interface HomeData {
  featured: FeaturedMovie[];
  newReleases: MovieCard[];
  popular: MovieCard[];
  reels: Reel[];
  categories: { category: Category; movies: MovieCard[] }[];
}

export interface PlanInfo {
  code: string;
  nameMn: string;
  nameEn: string;
  price: number;
  durationDays: number;
}

export interface Plan extends PlanInfo {
  id: number;
  descriptionMn: string | null;
  descriptionEn: string | null;
  isDefault: boolean;
}

export interface Episode {
  id: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string | null;
  titleEn: string | null;
  description: string | null;
  durationSec: number | null;
  still: ImageSet | null;
  videoReady: boolean;
  isFree: boolean;
}

export interface MovieDetail {
  id: string;
  kind: MovieKind;
  freeEpisodes: number;
  episodes: Episode[];
  slug: string;
  title: string;
  titleEn: string | null;
  description: string;
  descriptionEn: string | null;
  releaseYear: number | null;
  durationSec: number | null;
  ageRating: string | null;
  imdbRating: number | null;
  country: string | null;
  director: string | null;
  cast: string | null;
  trailerUrl: string | null;
  accessType: AccessType;
  posterColor: string | null;
  poster: ImageSet | null;
  backdrop: ImageSet | null;
  videoReady: boolean;
  categories: Category[];
  pricing: { rentPrice: number; rentHours: number; plan: PlanInfo | null };
  related: MovieCard[];
}

export interface AccessInfo {
  access: { allowed: boolean; reason: 'FREE' | 'FREE_EPISODE' | 'SUBSCRIPTION' | 'RENTAL' | 'STAFF' | null; expiresAt: string | null };
  progress: { positionSec: number; durationSec: number | null; episodeId: string | null } | null;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pages: number;
}

export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'REFUNDED';

export interface PaymentView {
  id: string;
  type: 'RENTAL' | 'SUBSCRIPTION';
  status: PaymentStatus;
  amount: number;
  currency: string;
  paymentUrl: string | null;
  qrText: string | null;
  qrImage: string | null;
  deeplinks: { name: string; logo?: string; link: string }[] | null;
  expiresAt: string;
  paidAt: string | null;
  movie: { title: string; slug: string } | null;
  plan: { nameMn: string; nameEn: string } | null;
  grantUntil?: string | null;
}

export interface EpisodeRef {
  id: string;
  movieId: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string | null;
  titleEn: string | null;
  durationSec: number | null;
}

export interface PlaybackSession {
  manifestUrl: string;
  expiresIn: number;
  resumeAt: number;
  durationSec: number | null;
  heartbeatSec: number;
  episode?: EpisodeRef;
  next?: EpisodeRef | null;
}

export interface Reel {
  id: string;
  caption: string | null;
  video: string | null;
  poster: string | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  viewCount: number;
  movie: MovieCard | null;
}
