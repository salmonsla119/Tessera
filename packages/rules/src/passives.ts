import { requireBase, type StatusKind } from '@tessera/data';
import { chebyshev } from './board';
import type { MatchState, PieceState } from './types';

/** 이 기물이 해당 상태이상에 걸리지 않는지 (statusImmune 패시브). */
export function isImmuneToStatus(piece: PieceState, status: StatusKind): boolean {
  const passive = requireBase(piece.baseId).passive;
  return passive?.kind === 'statusImmune' && passive.status === status;
}

/**
 * state.ts의 livingPieces를 쓰지 않고 직접 필터링한다 — state.ts가 effectiveEva/effectiveAtk에서
 * 이 모듈을 불러오므로, 여기서 state.ts를 다시 불러오면 순환 참조가 된다.
 */
function livingAllies(state: MatchState, owner: PieceState['owner']): PieceState[] {
  return state.pieces.filter((p) => p.alive && p.owner === owner);
}

function auraBonus(state: MatchState, piece: PieceState, stat: 'atk' | 'eva'): number {
  if (!piece.pos) return 0;
  let bonus = 0;
  for (const ally of livingAllies(state, piece.owner)) {
    if (!ally.pos) continue;
    const passive = requireBase(ally.baseId).passive;
    if (passive?.kind !== 'auraBuff' || passive.stat !== stat) continue;
    if (chebyshev(piece.pos, ally.pos) <= passive.radius) bonus += passive.value;
  }
  return bonus;
}

/** auraBuff(atk) 패시브를 가진 반경 내 아군(자신 포함) 전원의 보정을 더한 값. */
export function auraAtkBonus(state: MatchState, piece: PieceState): number {
  return auraBonus(state, piece, 'atk');
}

/** auraBuff(eva) 패시브를 가진 반경 내 아군(자신 포함) 전원의 보정을 더한 값. */
export function auraEvaBonus(state: MatchState, piece: PieceState): number {
  return auraBonus(state, piece, 'eva');
}

export interface AuraHealTarget {
  targetId: string;
  amount: number;
}

/** healer의 auraHeal 패시브로 회복시킬 대상들 — 반경 내 다친 아군(자신 포함). */
export function auraHealTargets(state: MatchState, healer: PieceState): AuraHealTarget[] {
  const passive = requireBase(healer.baseId).passive;
  if (passive?.kind !== 'auraHeal' || !healer.pos) return [];

  const results: AuraHealTarget[] = [];
  for (const ally of livingAllies(state, healer.owner)) {
    if (!ally.pos || ally.hp >= ally.maxHp) continue;
    if (chebyshev(healer.pos, ally.pos) <= passive.radius) {
      results.push({ targetId: ally.id, amount: passive.amount });
    }
  }
  return results;
}
