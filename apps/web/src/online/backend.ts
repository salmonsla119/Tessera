import type { Action } from '@tessera/rules';
import type { Backend, MatchView, StoredDeck } from '../backend/types';
import { api } from './api';

/**
 * apps/server(Cloudflare Workers)에 붙는 원격 구현.
 *
 * Backend 인터페이스 중 createMatch는 쓰지 않는다 — 온라인 대전은 큐를 거쳐 비동기로
 * 매치가 생기므로 "두 덱을 동시에 넘겨 즉석에서 매치를 만든다"는 계약과 맞지 않는다.
 * 큐 등록은 apps/web/src/online에서 따로 다루고, 매치가 성사된 뒤부터는 이 백엔드의
 * getMatch/submitAction만으로 MatchController를 그대로 재사용한다.
 */
export class RemoteBackend implements Backend {
  readonly kind = 'remote';

  async listDecks(): Promise<StoredDeck[]> {
    return api.listDecks();
  }

  async saveDeck(deck: StoredDeck): Promise<void> {
    await api.saveDeck(deck);
  }

  async deleteDeck(id: string): Promise<void> {
    await api.deleteDeck(id);
  }

  async createMatch(): Promise<MatchView> {
    throw new Error('온라인 대전은 매칭 큐를 통해서만 시작할 수 있습니다');
  }

  async getMatch(matchId: string): Promise<MatchView | null> {
    try {
      const detail = await api.getMatch(matchId);
      return { matchId, state: detail.state, events: [] };
    } catch {
      return null;
    }
  }

  async submitAction(matchId: string, action: Action): Promise<MatchView> {
    const result =
      action.type === 'deploy'
        ? await api.deploy(matchId, action.placements)
        : await api.submitAction(matchId, action);
    return { matchId, state: result.state, events: result.events };
  }

  async abandonMatch(): Promise<void> {
    // 비동기 매치는 화면을 나간다고 끝나지 않는다 — 상대는 계속 진행 중인 매치를 본다.
  }
}
