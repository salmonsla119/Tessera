import {
  applyAction as applyActionRules,
  checkAction,
  createMatch,
  IllegalActionError,
  type Action,
  type ApplyResult,
  type DeckSnapshot,
  type GameEvent,
  type MatchState,
  type PieceState,
  type PlayerId,
} from '@tessera/rules';
import type { MatchRow, MatchStatus } from './db';

export const TURN_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export { IllegalActionError };

/**
 * 배치 완료 전에는 상대 기물의 베이스·스킬·스탯·좌표를 전부 숨긴다 (GDD §8.1 — 상대 덱은
 * 매치 시작 시 보이지 않고, 양측 제출이 끝나야 동시에 공개된다). 응답에서 아예 제거해야
 * 하므로 클라이언트에서 UI로 가리는 방식은 쓰지 않는다 (PLAN §4.2).
 */
export function maskState(state: MatchState, viewerRole: PlayerId): MatchState {
  if (state.deployedPlayers.length === 2) return state;

  return {
    ...state,
    pieces: state.pieces.map((p) => (p.owner === viewerRole ? p : maskPiece(p))),
  };
}

function maskPiece(p: PieceState): PieceState {
  return {
    id: p.id,
    owner: p.owner,
    baseId: '',
    skillId: '',
    hp: 0,
    maxHp: 0,
    sp: 0,
    maxSp: 0,
    atk: 0,
    baseEva: 0,
    spd: 0,
    pos: null,
    alive: p.alive,
    statuses: [],
  };
}

export function buildMatchRow(params: {
  id: string;
  playerA: string;
  playerB: string;
  deckA: DeckSnapshot;
  deckB: DeckSnapshot;
  seed: number;
  ranked: boolean;
  now: number;
}): MatchRow {
  const state = createMatch(params.deckA, params.deckB, params.seed);
  return {
    id: params.id,
    player_a: params.playerA,
    player_b: params.playerB,
    ranked: params.ranked ? 1 : 0,
    state: JSON.stringify(state),
    action_count: 0,
    status: state.phase as MatchStatus,
    turn_deadline: params.now + TURN_TIMEOUT_MS,
    created_at: params.now,
    updated_at: params.now,
  };
}

export interface AppliedAction {
  result: ApplyResult;
  status: MatchStatus;
  turnDeadline: number | null;
}

/**
 * 액션을 재검증(PLAN §4.2)한 뒤 적용한다. 불법 액션은 IllegalActionError를 던진다.
 * 턴이 새로 시작될 때(TurnStarted 이벤트)만 제한시간을 갱신한다 — 그 밖의 액션은 같은
 * 턴 안에서의 진행이므로 기존 마감을 건드리지 않는다.
 */
export function applyMatchAction(
  currentState: MatchState,
  action: Action,
  currentDeadline: number | null,
  now: number,
): AppliedAction {
  const legality = checkAction(currentState, action);
  if (!legality.ok) throw new IllegalActionError(legality.reason ?? '허용되지 않는 액션입니다', action);

  const result = applyActionRules(currentState, action);
  const status = result.state.phase as MatchStatus;

  let turnDeadline = currentDeadline;
  if (status === 'finished') {
    turnDeadline = null;
  } else if (hasTurnStarted(result.events)) {
    turnDeadline = now + TURN_TIMEOUT_MS;
  }

  return { result, status, turnDeadline };
}

function hasTurnStarted(events: GameEvent[]): boolean {
  return events.some((e) => e.type === 'TurnStarted');
}
