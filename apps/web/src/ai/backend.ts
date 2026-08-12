import { applyAction, createMatch, type Action, type DeckSnapshot, type MatchState } from '@tessera/rules';
import type { Backend, MatchView, StoredDeck } from '../backend/types';

/**
 * AI 대전 전용 백엔드 — 규칙 엔진을 브라우저에서 그대로 돌린다는 점은 LocalBackend와 같지만,
 * 메모리에만 둔다. 로컬 핫시트의 "이어하기" 저장소(localStorage)와 키가 겹치면 새로고침 후
 * 메뉴의 이어하기 배너가 AI 매치를 가리키게 되므로 일부러 저장하지 않는다 — 새로고침하면
 * 끝나는 캐주얼한 연습 대전으로 취급한다.
 */
export class AiMatchBackend implements Backend {
  readonly kind = 'ai';

  private current: { matchId: string; state: MatchState } | null = null;

  async listDecks(): Promise<StoredDeck[]> {
    return [];
  }

  async saveDeck(): Promise<void> {
    // AI 대전에서는 쓰지 않는다 — 덱 목록은 메인 화면의 LocalBackend가 관리한다.
  }

  async deleteDeck(): Promise<void> {
    // 위와 동일한 이유로 미사용.
  }

  async createMatch(deckA: DeckSnapshot, deckB: DeckSnapshot): Promise<MatchView> {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
    const state = createMatch(deckA, deckB, seed);
    this.current = { matchId: `ai-${seed.toString(36)}`, state };
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
    const { state, events } = applyAction(this.current.state, action);
    this.current = { matchId, state };
    return { matchId, state, events };
  }

  async abandonMatch(matchId: string): Promise<void> {
    if (this.current?.matchId === matchId) this.current = null;
  }
}
