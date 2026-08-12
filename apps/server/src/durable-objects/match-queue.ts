import type { DeckSnapshot } from '@tessera/rules';
import { insertMatch } from '../db';
import { buildMatchRow } from '../match';
import type { Env } from '../types';

interface WaitingEntry {
  userId: string;
  deckSnapshot: DeckSnapshot;
  lastOpponentId: string | null;
  joinedAt: number;
}

export interface QueueStatus {
  status: 'waiting' | 'matched' | 'not_waiting' | 'cancelled';
  matchId?: string;
  waitingCount?: number;
  joinedAt?: number;
}

const WAITING_KEY = 'waiting';
const MATCHED_KEY = 'matched';

/**
 * 매칭 큐 전체를 담당하는 단일 인스턴스 (PLAN §5.3).
 *
 * Durable Object는 들어오는 요청을 인스턴스당 순차 처리한다 — 이 직렬성 자체가
 * `SELECT ... FOR UPDATE SKIP LOCKED`가 Postgres에서 막던 경합(동시 등록이 같은
 * 대기자를 동시에 집어가는 것, 빈 큐에 둘이 동시에 들어와 서로를 못 보는 것)을
 * 구조적으로 없앤다. 별도 스위퍼 없이도 §8.4의 동시성 요구사항을 만족한다.
 */
export class MatchQueue implements DurableObject {
  private waiting = new Map<string, WaitingEntry>();
  private matched = new Map<string, string>();
  private readonly ready: Promise<void>;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {
    this.ready = this.ctx.blockConcurrencyWhile(async () => {
      const w = await this.ctx.storage.get<[string, WaitingEntry][]>(WAITING_KEY);
      if (w) this.waiting = new Map(w);
      const m = await this.ctx.storage.get<[string, string][]>(MATCHED_KEY);
      if (m) this.matched = new Map(m);
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    const url = new URL(request.url);
    const body = request.method === 'POST' ? await request.json<Record<string, unknown>>() : {};

    let result: QueueStatus;
    switch (url.pathname) {
      case '/join':
        result = await this.join(body as { userId: string; deckSnapshot: DeckSnapshot; lastOpponentId: string | null; now: number });
        break;
      case '/leave':
        result = await this.leave((body as { userId: string }).userId);
        break;
      case '/status':
        result = await this.status(url.searchParams.get('userId') ?? '');
        break;
      default:
        return new Response('not found', { status: 404 });
    }
    return Response.json(result);
  }

  private async persist(): Promise<void> {
    await this.ctx.storage.put(WAITING_KEY, [...this.waiting.entries()]);
    await this.ctx.storage.put(MATCHED_KEY, [...this.matched.entries()]);
  }

  private async join(params: {
    userId: string;
    deckSnapshot: DeckSnapshot;
    lastOpponentId: string | null;
    now: number;
  }): Promise<QueueStatus> {
    const { userId } = params;

    // 중복 등록: 이미 대기 중이면 기존 대기를 그대로 반환한다 (PLAN §8.4 — 큐에 행 2개를 만들지 않음).
    const already = this.waiting.get(userId);
    if (already) return { status: 'waiting', waitingCount: this.waiting.size, joinedAt: already.joinedAt };

    const pendingMatch = this.matched.get(userId);
    if (pendingMatch) {
      this.matched.delete(userId);
      await this.persist();
      return { status: 'matched', matchId: pendingMatch };
    }

    const candidate = this.pickCandidate(userId, params.lastOpponentId);
    if (candidate) {
      this.waiting.delete(candidate.userId);
      const matchId = crypto.randomUUID();
      const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
      const row = buildMatchRow({
        id: matchId,
        playerA: candidate.userId,
        playerB: userId,
        deckA: candidate.deckSnapshot,
        deckB: params.deckSnapshot,
        seed,
        ranked: false,
        now: params.now,
      });
      await insertMatch(this.env.DB, row);
      // 상대(candidate)는 이 응답을 받지 못하므로, 다음에 join/leave/status를 호출할 때
      // 성사된 매치를 알 수 있도록 남겨 둔다.
      this.matched.set(candidate.userId, matchId);
      await this.persist();
      return { status: 'matched', matchId };
    }

    this.waiting.set(userId, {
      userId,
      deckSnapshot: params.deckSnapshot,
      lastOpponentId: params.lastOpponentId,
      joinedAt: params.now,
    });
    await this.persist();
    return { status: 'waiting', waitingCount: this.waiting.size, joinedAt: params.now };
  }

  private async leave(userId: string): Promise<QueueStatus> {
    if (this.waiting.delete(userId)) {
      await this.persist();
      return { status: 'cancelled' };
    }
    // 취소와 매칭 성사가 동시에 일어날 수 있다 — 에러 대신 성사된 매치를 반환한다 (PLAN §5.6).
    const matchId = this.matched.get(userId);
    if (matchId) {
      this.matched.delete(userId);
      await this.persist();
      return { status: 'matched', matchId };
    }
    return { status: 'not_waiting' };
  }

  private async status(userId: string): Promise<QueueStatus> {
    const matchId = this.matched.get(userId);
    if (matchId) {
      this.matched.delete(userId);
      await this.persist();
      return { status: 'matched', matchId };
    }
    const entry = this.waiting.get(userId);
    if (entry) return { status: 'waiting', waitingCount: this.waiting.size, joinedAt: entry.joinedAt };
    return { status: 'not_waiting', waitingCount: this.waiting.size };
  }

  /** 직전 상대는 피하되(§5.3), 대기자가 그뿐이면 그 사람과라도 짝짓는다 (기아 방지). */
  private pickCandidate(me: string, lastOpponentId: string | null): WaitingEntry | null {
    let fallback: WaitingEntry | null = null;
    let preferred: WaitingEntry | null = null;
    for (const entry of this.waiting.values()) {
      if (entry.userId === me) continue;
      if (!fallback || entry.joinedAt < fallback.joinedAt) fallback = entry;
      if (entry.userId === lastOpponentId) continue;
      if (!preferred || entry.joinedAt < preferred.joinedAt) preferred = entry;
    }
    return preferred ?? fallback;
  }
}
