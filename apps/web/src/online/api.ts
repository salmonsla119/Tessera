import type { DeckPiece } from '@tessera/data';
import type { Action, GameEvent, MatchState, PlayerId } from '@tessera/rules';

/**
 * 배포 시점에는 GitHub Pages 빌드에 이 값을 주입한다 (deploy-pages.yml).
 * 값이 없으면 온라인 대전은 그냥 비활성으로 취급한다 — 서버 없이도 로컬/AI 대전은 그대로 동작해야 한다.
 */
export const API_BASE: string = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';

export function onlineEnabled(): boolean {
  return API_BASE.length > 0;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...init.headers },
    ...init,
  });

  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(body.error ?? `요청 실패 (${res.status})`, res.status);
  return body as T;
}

export interface OnlineUser {
  id: string;
  username: string;
}

export interface OnlineDeck {
  id: string;
  name: string;
  pieces: DeckPiece[];
}

export interface QueueStatus {
  status: 'waiting' | 'matched' | 'not_waiting' | 'cancelled';
  matchId?: string;
  waitingCount?: number;
  joinedAt?: number;
}

export interface MatchSummary {
  id: string;
  role: PlayerId;
  opponentUsername: string;
  phase: MatchState['phase'];
  myTurn: boolean;
  winner: MatchState['winner'];
  turnDeadline: number | null;
  updatedAt: number;
}

export interface MatchDetail {
  id: string;
  role: PlayerId;
  state: MatchState;
  turnDeadline: number | null;
  actions: { seq: number; player: string; events: GameEvent[]; createdAt: number }[];
}

/** 계정 보유 현황 (신규 시스템 — 가챠). ID만 내려온다 — 이름/스탯은 @tessera/data에서 조회한다. */
export interface Inventory {
  currency: number;
  bases: string[];
  skills: string[];
}

export interface GachaPullResult {
  item: { itemType: 'base' | 'skill'; itemId: string; rarity: 'common' | 'rare' | 'legendary' };
  duplicate: boolean;
  refund: number;
  currency: number;
}

export interface MatchRewardResult {
  granted: boolean;
  currency: number;
}

export const api = {
  signup: (username: string, password: string) =>
    request<OnlineUser>('/auth/signup', { method: 'POST', body: JSON.stringify({ username, password }) }),
  login: (username: string, password: string) =>
    request<OnlineUser>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
  me: () => request<OnlineUser>('/auth/me'),

  listDecks: () => request<OnlineDeck[]>('/decks'),
  saveDeck: (deck: OnlineDeck) =>
    request<OnlineDeck>('/decks', { method: 'POST', body: JSON.stringify(deck) }),
  deleteDeck: (id: string) => request<{ ok: true }>(`/decks/${id}`, { method: 'DELETE' }),

  joinQueue: (deckId: string) => request<QueueStatus>('/queue', { method: 'POST', body: JSON.stringify({ deckId }) }),
  queueStatus: () => request<QueueStatus>('/queue'),
  leaveQueue: () => request<QueueStatus>('/queue', { method: 'DELETE' }),

  createPrivateMatch: (deckId: string) =>
    request<{ code: string }>('/matches/private', { method: 'POST', body: JSON.stringify({ deckId }) }),
  joinPrivateMatch: (code: string, deckId: string) =>
    request<{ matchId: string }>(`/matches/private/${code}/join`, {
      method: 'POST',
      body: JSON.stringify({ deckId }),
    }),

  listMatches: () => request<MatchSummary[]>('/matches'),
  getMatch: (id: string) => request<MatchDetail>(`/matches/${id}`),
  deploy: (id: string, placements: { pieceId: string; pos: { x: number; y: number } }[]) =>
    request<{ state: MatchState; events: GameEvent[] }>(`/matches/${id}/deploy`, {
      method: 'POST',
      body: JSON.stringify({ placements }),
    }),
  submitAction: (id: string, action: Action) =>
    request<{ state: MatchState; events: GameEvent[] }>(`/matches/${id}/actions`, {
      method: 'POST',
      body: JSON.stringify(action),
    }),

  getInventory: () => request<Inventory>('/inventory'),
  gachaPull: () => request<GachaPullResult>('/gacha/pull', { method: 'POST' }),
  claimMatchReward: (mode: 'online' | 'local' | 'ai', matchId: string) =>
    request<MatchRewardResult>('/rewards/match-complete', { method: 'POST', body: JSON.stringify({ mode, matchId }) }),
};
