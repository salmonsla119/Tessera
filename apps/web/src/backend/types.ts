import type { DeckPiece } from '@tessera/data';
import type { Action, DeckSnapshot, GameEvent, MatchState, PlayerId } from '@tessera/rules';

export interface StoredDeck {
  id: string;
  name: string;
  pieces: DeckPiece[];
}

export interface MatchView {
  matchId: string;
  /** 요청자 시점의 상태. 서버 구현에서는 미공개 정보가 제거되어 온다 (PLAN §4.2). */
  state: MatchState;
  /** 마지막 액션이 만들어낸 연출용 이벤트. */
  events: GameEvent[];
}

/**
 * 클라이언트가 바라보는 백엔드 계약.
 *
 * 지금은 규칙 엔진을 브라우저에서 그대로 돌리는 LocalBackend 하나뿐이지만,
 * 모든 메서드가 비동기라서 원격 구현을 끼워 넣을 때 호출부를 고치지 않아도 된다.
 *
 * 원격 구현이 반드시 지켜야 하는 것 (PLAN §4.2):
 *  - 클라이언트가 보낸 액션을 서버에서 checkAction으로 재검증한 뒤에만 적용한다.
 *  - 모든 주사위는 서버에서 굴린다. 클라이언트가 보낸 굴림 결과는 무시한다.
 *  - 배치 공개 전에는 상대 덱 구성과 좌표를 응답에서 아예 제거한다.
 */
export interface Backend {
  readonly kind: string;

  listDecks(): Promise<StoredDeck[]>;
  saveDeck(deck: StoredDeck): Promise<void>;
  deleteDeck(id: string): Promise<void>;

  createMatch(deckA: DeckSnapshot, deckB: DeckSnapshot): Promise<MatchView>;
  getMatch(matchId: string): Promise<MatchView | null>;
  submitAction(matchId: string, action: Action): Promise<MatchView>;
  abandonMatch(matchId: string): Promise<void>;
}

/**
 * 배치 공개 전 마스킹 (PLAN §4.2).
 *
 * 로컬 핫시트에서는 한 화면을 두 사람이 번갈아 쓰므로 이 함수로 상대 정보를 가린다.
 * 원격 구현에서는 서버가 응답을 만들 때 같은 규칙을 적용해야 한다 — 클라이언트에서
 * 가리는 방식은 개발자 도구로 뚫린다.
 */
export function maskState(state: MatchState, viewer: PlayerId): MatchState {
  if (state.phase !== 'deploying') return state;
  return {
    ...state,
    pieces: state.pieces.map((piece) =>
      piece.owner === viewer ? piece : { ...piece, pos: null, baseId: 'hidden', skillId: 'hidden' },
    ),
  };
}
