import { deployZoneCells } from '../board';
import { applyAction } from '../resolve';
import { createMatch } from '../state';
import type { Action, Coord, DeckSnapshot, MatchState, PieceState, PlayerId } from '../types';

export function deck(name: string, ...pieces: Array<[string, string]>): DeckSnapshot {
  return { name, pieces: pieces.map(([baseId, skillId]) => ({ baseId, skillId })) };
}

export function autoDeployAction(state: MatchState, player: PlayerId): Action {
  const own = state.pieces.filter((p) => p.owner === player);
  const cells = deployZoneCells(player);
  const ordered = player === 'A' ? [...cells].reverse() : cells;
  return {
    type: 'deploy',
    player,
    placements: own.map((piece, index) => ({ pieceId: piece.id, pos: ordered[index]! })),
  };
}

/** 배치까지 끝내고 전투 단계에 들어간 매치를 만든다. */
export function startedMatch(a: DeckSnapshot, b: DeckSnapshot, seed = 1): MatchState {
  let state = createMatch(a, b, seed);
  state = applyAction(state, autoDeployAction(state, 'A')).state;
  state = applyAction(state, autoDeployAction(state, 'B')).state;
  return state;
}

/**
 * 테스트에서 보드를 원하는 모양으로 직접 배치한다.
 * 배치 단계를 건너뛰고 전투 상태를 손으로 세팅하기 위한 용도.
 */
export function place(state: MatchState, layout: Record<string, Coord | null>): MatchState {
  const next: MatchState = {
    ...state,
    pieces: state.pieces.map((p) => ({ ...p, pos: p.pos ? { ...p.pos } : null, statuses: [...p.statuses] })),
  };
  for (const piece of next.pieces) {
    if (piece.id in layout) {
      const pos = layout[piece.id] ?? null;
      piece.pos = pos ? { ...pos } : null;
      piece.alive = pos !== null;
    } else {
      // 레이아웃에 없는 기물은 보드에서 치운다 — 테스트 대상만 남긴다.
      piece.pos = null;
      piece.alive = false;
    }
  }
  return next;
}

export function pieceOf(state: MatchState, id: string): PieceState {
  const piece = state.pieces.find((p) => p.id === id);
  if (!piece) throw new Error(`no piece ${id}`);
  return piece;
}

export function cellSet(cells: Coord[]): Set<string> {
  return new Set(cells.map((c) => `${c.x},${c.y}`));
}
