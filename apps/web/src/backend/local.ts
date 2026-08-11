import { applyAction, createMatch, type Action, type DeckSnapshot, type MatchState } from '@tessera/rules';
import type { Backend, MatchView, StoredDeck } from './types';

const DECKS_KEY = 'tessera.decks.v1';
const MATCH_KEY = 'tessera.match.v1';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 저장 실패는 치명적이지 않다 — 진행 중인 매치는 메모리에도 남아 있다.
  }
}

interface StoredMatch {
  matchId: string;
  state: MatchState;
}

/**
 * 로컬 핫시트 백엔드 — 규칙 엔진을 브라우저에서 그대로 돌린다.
 *
 * 서버 권위가 없으므로 부정 방지는 성립하지 않는다. 한 화면을 두 사람이 번갈아 쓰는
 * 상황을 전제로 하며, 온라인 대전은 이 인터페이스를 구현한 원격 백엔드로 대체한다.
 */
export class LocalBackend implements Backend {
  readonly kind = 'local';

  private current: StoredMatch | null = read<StoredMatch | null>(MATCH_KEY, null);

  async listDecks(): Promise<StoredDeck[]> {
    return read<StoredDeck[]>(DECKS_KEY, []);
  }

  async saveDeck(deck: StoredDeck): Promise<void> {
    const decks = await this.listDecks();
    const index = decks.findIndex((d) => d.id === deck.id);
    if (index >= 0) decks[index] = deck;
    else decks.push(deck);
    write(DECKS_KEY, decks);
  }

  async deleteDeck(id: string): Promise<void> {
    write(DECKS_KEY, (await this.listDecks()).filter((d) => d.id !== id));
  }

  async createMatch(deckA: DeckSnapshot, deckB: DeckSnapshot): Promise<MatchView> {
    // 매치 시드는 서버가 암호학적 난수로 만든다 (PLAN §5.5). 로컬에서는 브라우저 CSPRNG로 대신한다.
    const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
    const state = createMatch(deckA, deckB, seed);
    this.current = { matchId: `local-${seed.toString(36)}`, state };
    write(MATCH_KEY, this.current);
    return { matchId: this.current.matchId, state, events: [{ type: 'MatchCreated', first: state.first }] };
  }

  async getMatch(matchId: string): Promise<MatchView | null> {
    if (!this.current || this.current.matchId !== matchId) return null;
    return { matchId, state: this.current.state, events: [] };
  }

  async submitAction(matchId: string, action: Action): Promise<MatchView> {
    if (!this.current || this.current.matchId !== matchId) {
      throw new Error('진행 중인 매치를 찾을 수 없습니다');
    }
    // 원격 구현에서는 이 호출이 서버에서 일어난다. 액션 검증과 주사위 굴림 모두 여기서 처리된다.
    const { state, events } = applyAction(this.current.state, action);
    this.current = { matchId, state };
    write(MATCH_KEY, this.current);
    return { matchId, state, events };
  }

  async abandonMatch(matchId: string): Promise<void> {
    if (this.current?.matchId === matchId) {
      this.current = null;
      localStorage.removeItem(MATCH_KEY);
    }
  }

  /** 새로고침 후 이어할 매치가 있는지. */
  resumableMatchId(): string | null {
    return this.current?.matchId ?? null;
  }
}
