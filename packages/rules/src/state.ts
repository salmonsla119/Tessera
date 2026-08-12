import { EVA_CAP, FOREST_EVA_BONUS, SECOND_PLAYER_BONUS_TENTHS, requireBase } from '@tessera/data';
import { createRng, rollDie } from './rng';
import { opponentOf } from './board';
import { auraAtkBonus, auraEvaBonus } from './passives';
import { generateTerrain, isImmuneToTerrain, terrainAt } from './terrain';
import type { Coord, DeckSnapshot, MatchState, PieceState, PlayerId } from './types';

/** 얕은 복사 기반 불변 갱신 헬퍼. 상태는 전부 순수 JSON이라 깊은 복사가 안전하다. */
export function cloneState(state: MatchState): MatchState {
  return {
    ...state,
    pieces: state.pieces.map((p) => ({
      ...p,
      pos: p.pos ? { ...p.pos } : null,
      statuses: p.statuses.map((s) => ({ ...s })),
    })),
    terrain: { ...state.terrain },
    teamSpeed: { ...state.teamSpeed },
    apPoolTenths: { ...state.apPoolTenths },
    ap: { ...state.ap },
    deployedPlayers: [...state.deployedPlayers],
  };
}

function buildPieces(deck: DeckSnapshot, owner: PlayerId): PieceState[] {
  return deck.pieces.map((piece, index) => {
    const base = requireBase(piece.baseId);
    return {
      id: `${owner}${index}`,
      owner,
      baseId: piece.baseId,
      skillId: piece.skillId,
      hp: base.hp,
      maxHp: base.hp,
      sp: base.sp,
      maxSp: base.sp,
      atk: base.atk,
      baseEva: base.eva,
      spd: base.spd,
      pos: null,
      alive: true,
      statuses: [],
    };
  });
}

/**
 * 매치 생성 (GDD §8.1).
 *
 * 선공은 서버가 양측 d20을 굴려 결정하고, 동점이면 재굴림한다.
 * 후공은 시작 apPool에 +0.5를 얹는다 (GDD §8.4).
 * 지형도 이 시점에 같은 시드 RNG로 확정한다 — 매치 내내 바뀌지 않고, 리플레이가 결정론적이다.
 */
export function createMatch(deckA: DeckSnapshot, deckB: DeckSnapshot, seed: number): MatchState {
  const rng = createRng(seed);

  let first: PlayerId;
  for (;;) {
    const rollA = rollDie(rng, 20);
    const rollB = rollDie(rng, 20);
    if (rollA !== rollB) {
      first = rollA > rollB ? 'A' : 'B';
      break;
    }
  }
  const second = opponentOf(first);

  const terrain = generateTerrain(rng);
  const pieces = [...buildPieces(deckA, 'A'), ...buildPieces(deckB, 'B')];

  const teamSpeed: Record<PlayerId, number> = {
    A: sumSpeed(pieces, 'A'),
    B: sumSpeed(pieces, 'B'),
  };

  const apPoolTenths: Record<PlayerId, number> = { A: 0, B: 0 };
  apPoolTenths[second] = SECOND_PLAYER_BONUS_TENTHS;

  return {
    seed,
    rngCursor: rng.cursor,
    phase: 'deploying',
    first,
    turnOwner: first,
    turn: 0,
    round: 0,
    pieces,
    terrain,
    teamSpeed,
    apPoolTenths,
    ap: { A: 0, B: 0 },
    deployedPlayers: [],
    winner: null,
    suddenDeath: false,
  };
}

function sumSpeed(pieces: readonly PieceState[], owner: PlayerId): number {
  return pieces.reduce((sum, p) => (p.owner === owner ? sum + p.spd : sum), 0);
}

export function getPiece(state: MatchState, id: string): PieceState | undefined {
  return state.pieces.find((p) => p.id === id);
}

export function pieceAt(state: MatchState, c: Coord): PieceState | undefined {
  return state.pieces.find((p) => p.alive && p.pos !== null && p.pos.x === c.x && p.pos.y === c.y);
}

export function isOccupied(state: MatchState, c: Coord): boolean {
  return pieceAt(state, c) !== undefined;
}

export function livingPieces(state: MatchState, owner?: PlayerId): PieceState[] {
  return state.pieces.filter((p) => p.alive && (owner === undefined || p.owner === owner));
}

/**
 * 실효 회피율 (GDD §3.3 + 신규 시스템). 상태이상·지형(숲)·아군 오라를 모두 더한 뒤 0~60%로 자른다.
 * 상한은 최종값에 적용되므로 EVA 80 기물은 다른 보정이 없으면 60%가 된다.
 */
export function effectiveEva(state: MatchState, piece: PieceState): number {
  let eva = piece.baseEva;
  for (const status of piece.statuses) {
    if (status.kind === 'evaDown') eva -= status.value;
  }
  if (piece.pos) {
    const terrain = terrainAt(state, piece.pos);
    if (terrain === 'forest' && !isImmuneToTerrain(piece, terrain)) eva += FOREST_EVA_BONUS;
  }
  eva += auraEvaBonus(state, piece);
  return Math.max(0, Math.min(EVA_CAP, eva));
}

/** 실효 공격력 — 아군 오라(auraBuff atk) 보정을 더한다 (신규 시스템). */
export function effectiveAtk(state: MatchState, piece: PieceState): number {
  return piece.atk + auraAtkBonus(state, piece);
}

/** 빙결 상태면 이동·공격·집중 모두 막힌다 (신규 시스템). */
export function isFrozen(piece: PieceState): boolean {
  return piece.statuses.some((s) => s.kind === 'freeze' && s.turnsLeft > 0);
}

/** 편성된 스킬을 지금 쓸 수 있는지 — 잔여 SP가 코스트 미만이면 잠긴다 (GDD §4). */
export function canAffordSp(piece: PieceState, spCost: number): boolean {
  return piece.sp >= spCost;
}
