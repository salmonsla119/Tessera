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

/**
 * 배치까지 끝내고 전투 단계에 들어간 매치를 만든다.
 *
 * 지형은 항상 걷어낸다 — 이 헬퍼를 쓰는 대부분의 테스트는 AP·데미지·상태이상 등 지형과
 * 무관한 것을 보는데, 지형이 배치 구역까지 뒤덮을 수 있게 된 뒤로는 시드에 따라 기물이
 * 배치되자마자 얼거나 화상을 입는 등 무관한 노이즈가 끼어들 수 있다. 지형 자체를 보는
 * 테스트는 terrain.ts의 generateTerrain을 직접 부르거나 이 상태에 원하는 지형을 덮어쓴다.
 */
export function startedMatch(a: DeckSnapshot, b: DeckSnapshot, seed = 1): MatchState {
  // 지형을 배치 전에 걷어내야 한다 — 두 번째 deploy가 곧장 startTurn()을 트리거하므로,
  // 사후에 지형 맵만 비워서는 그사이 이미 걸린 빙결·화상 같은 상태이상까지는 못 지운다.
  let state = { ...createMatch(a, b, seed), terrain: {} };
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

/**
 * 매치 생성 절차 없이 지정한 기물만 담은 최소 상태. 지형은 전부 평지(빈 맵)다 —
 * 데미지·회피처럼 보드 맥락이 필요 없는 단위 테스트용.
 */
export function bareState(pieces: PieceState[]): MatchState {
  return {
    seed: 1,
    rngCursor: 0,
    phase: 'battle',
    first: 'A',
    turnOwner: 'A',
    turn: 1,
    round: 1,
    pieces,
    terrain: {},
    teamSpeed: { A: 0, B: 0 },
    apPoolTenths: { A: 0, B: 0 },
    ap: { A: 5, B: 5 },
    deployedPlayers: ['A', 'B'],
    winner: null,
    suddenDeath: false,
  };
}
