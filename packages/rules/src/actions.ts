import { AP_COST_ATTACK, AP_COST_FOCUS, AP_COST_MOVE, requireSkill } from '@tessera/data';
import { chebyshev, coordKey, isDeployZone } from './board';
import { movableCells } from './movement';
import { getPiece, isFrozen, livingPieces } from './state';
import { targetableCells, usableSkills, validTargets } from './targeting';
import type { Action, MatchState, PlayerId } from './types';

export interface Legality {
  ok: boolean;
  reason?: string;
}

const OK: Legality = { ok: true };
const no = (reason: string): Legality => ({ ok: false, reason });

/**
 * 액션 1개의 합법성 검사.
 *
 * 서버는 클라이언트가 보낸 액션을 이 함수로 재검증한 뒤에만 적용한다 (PLAN §4.2).
 * 배치처럼 경우의 수가 폭발하는 액션은 열거 대신 이 검사로만 다룬다.
 */
export function checkAction(state: MatchState, action: Action): Legality {
  if (state.phase === 'finished') return no('이미 종료된 매치입니다');

  if (action.type === 'deploy') {
    if (state.phase !== 'deploying') return no('배치 단계가 아닙니다');
    if (state.deployedPlayers.includes(action.player)) return no('이미 배치를 제출했습니다');

    const own = state.pieces.filter((p) => p.owner === action.player);
    if (action.placements.length !== own.length) {
      return no(`기물 ${own.length}개를 모두 배치해야 합니다`);
    }

    const seenPieces = new Set<string>();
    const seenCells = new Set<string>();
    for (const placement of action.placements) {
      const piece = getPiece(state, placement.pieceId);
      if (!piece) return no(`알 수 없는 기물: ${placement.pieceId}`);
      if (piece.owner !== action.player) return no('상대 기물은 배치할 수 없습니다');
      if (seenPieces.has(placement.pieceId)) return no('같은 기물을 두 번 배치했습니다');
      if (!isDeployZone(action.player, placement.pos)) return no('자진 2열 밖에는 배치할 수 없습니다');
      const key = coordKey(placement.pos);
      if (seenCells.has(key)) return no('한 칸에 두 기물을 배치했습니다');
      seenPieces.add(placement.pieceId);
      seenCells.add(key);
    }
    return OK;
  }

  if (state.phase !== 'battle') return no('전투 단계가 아닙니다');
  if (action.player !== state.turnOwner) return no('상대 턴입니다');

  if (action.type === 'endTurn') return OK;

  const piece = getPiece(state, action.pieceId);
  if (!piece) return no(`알 수 없는 기물: ${action.pieceId}`);
  if (piece.owner !== action.player) return no('상대 기물은 조작할 수 없습니다');
  if (!piece.alive || piece.pos === null) return no('전사한 기물입니다');

  switch (action.type) {
    case 'move': {
      if (state.ap[action.player] < AP_COST_MOVE) return no('행동력이 부족합니다');
      if (isFrozen(piece)) return no('빙결 상태라 행동할 수 없습니다');
      const reachable = movableCells(state, piece);
      if (!reachable.some((c) => c.x === action.to.x && c.y === action.to.y)) {
        return no('이동할 수 없는 칸입니다');
      }
      return OK;
    }

    case 'attack': {
      if (state.ap[action.player] < AP_COST_ATTACK) return no('행동력이 부족합니다');
      if (isFrozen(piece)) return no('빙결 상태라 행동할 수 없습니다');
      const skill = usableSkills(piece).find((s) => s.id === action.skillId);
      if (!skill) {
        // 편성 스킬 자체가 없는 게 아니라 SP가 모자란 경우를 구분해 준다.
        const equipped = requireSkill(piece.skillId);
        if (action.skillId === equipped.id) return no(`SP 부족 (${piece.sp}/${equipped.spCost})`);
        return no('이 기물이 쓸 수 없는 스킬입니다');
      }
      const target = getPiece(state, action.targetId);
      if (!target) return no(`알 수 없는 대상: ${action.targetId}`);
      if (!target.alive || target.pos === null) return no('이미 전사한 대상입니다');

      // damage 스킬은 적만, heal·defense 스킬은 아군(자신 포함)만 대상이 된다 (신규 시스템).
      const isAlly = target.owner === action.player;
      if (skill.kind === 'heal' || skill.kind === 'defense') {
        if (!isAlly) return no(`${skill.kind === 'heal' ? '치유' : '방어'} 스킬은 아군만 대상으로 할 수 있습니다`);
      } else if (isAlly) {
        return no('아군은 공격할 수 없습니다');
      }

      // 자힐은 사거리 형태와 무관하게 항상 가능하다 (validTargets와 동일한 규칙).
      if (target.id !== piece.id) {
        const cells = targetableCells(state, piece.pos, skill);
        const targetPos = target.pos;
        if (!cells.some((c) => c.x === targetPos.x && c.y === targetPos.y)) {
          return no('사거리 밖이거나 경로가 막혀 있습니다');
        }
      }
      return OK;
    }

    case 'focus': {
      if (state.ap[action.player] < AP_COST_FOCUS) return no('행동력이 부족합니다');
      if (isFrozen(piece)) return no('빙결 상태라 행동할 수 없습니다');
      if (piece.sp >= piece.maxSp) return no('이미 SP가 최대입니다');
      return OK;
    }
  }
}

/**
 * 전투 단계에서 지금 둘 수 있는 모든 액션 (PLAN §3.1).
 *
 * 배치 액션은 조합 수가 커서 열거하지 않는다 — checkAction으로 검증한다.
 */
export function legalActions(state: MatchState, player: PlayerId): Action[] {
  if (state.phase !== 'battle' || state.turnOwner !== player) return [];

  const actions: Action[] = [{ type: 'endTurn', player }];
  const ap = state.ap[player];
  if (ap <= 0) return actions;

  for (const piece of livingPieces(state, player)) {
    if (piece.pos === null) continue;
    if (isFrozen(piece)) continue; // 빙결 중에는 아무 행동도 할 수 없다 (신규 시스템).

    if (ap >= AP_COST_MOVE) {
      for (const to of movableCells(state, piece)) {
        actions.push({ type: 'move', player, pieceId: piece.id, to });
      }
    }

    if (ap >= AP_COST_ATTACK) {
      for (const skill of usableSkills(piece)) {
        for (const target of validTargets(state, piece, skill)) {
          actions.push({ type: 'attack', player, pieceId: piece.id, skillId: skill.id, targetId: target.id });
        }
      }
    }

    if (ap >= AP_COST_FOCUS && piece.sp < piece.maxSp) {
      actions.push({ type: 'focus', player, pieceId: piece.id });
    }
  }

  return actions;
}

/** 공격 액션의 사거리 계산에 쓰는 체비셰프 거리. */
export function attackDistance(state: MatchState, attackerId: string, targetId: string): number {
  const attacker = getPiece(state, attackerId);
  const target = getPiece(state, targetId);
  if (!attacker?.pos || !target?.pos) return Number.POSITIVE_INFINITY;
  return chebyshev(attacker.pos, target.pos);
}
