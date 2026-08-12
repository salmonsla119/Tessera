import { DISTANCE_FALLOFF, DISTANCE_FALLOFF_MIN, type Skill } from '@tessera/data';
import { rollDie, rollInt, type Rng } from './rng';
import { effectiveAtk, effectiveEva } from './state';
import type { DamageRange, MatchState, PieceState } from './types';

/** 거리 감쇠 배율, 체비셰프 거리 기준 (GDD §3.2). 5칸 이상은 전부 0.40. */
export function distanceMultiplier(distance: number): number {
  return DISTANCE_FALLOFF[distance] ?? DISTANCE_FALLOFF_MIN;
}

/**
 * 데미지 파이프라인 1~3단계 (GDD §3.1) — 플레이어에게 표시되는 "예상 데미지".
 *
 * ```
 * [minD, maxD] → +ATK(오라 포함 실효치) → ×거리배율(양 끝값 반올림)
 * ```
 *
 * 클라이언트가 이 함수를 그대로 호출해 미리보기를 그리므로 서버 계산과 어긋나지 않는다.
 */
export function previewDamage(state: MatchState, attacker: PieceState, skill: Skill, distance: number): DamageRange {
  const multiplier = distanceMultiplier(distance);
  const atk = effectiveAtk(state, attacker);
  const min = Math.max(0, Math.round((skill.minDamage + atk) * multiplier));
  const max = Math.max(min, Math.round((skill.maxDamage + atk) * multiplier));
  return { min, max };
}

export interface DamageResolution {
  preview: DamageRange;
  /** 4단계: 주사위로 확정된 데미지. */
  rolled: number;
  /** 5단계: 회피 판정에 쓴 d100 값. */
  evadeRoll: number;
  evaded: boolean;
  /** 6단계: 실제로 HP에서 깎인 값. 회피 시 0. */
  dealt: number;
}

/**
 * 데미지 파이프라인 4~6단계 (GDD §3.1).
 *
 * 주사위 순서(데미지 → 회피)는 리플레이 결정론에 직접 영향을 주므로 바꾸지 않는다.
 * 모든 굴림은 서버에서만 수행된다 (GDD §3.4).
 */
export function resolveDamage(
  rng: Rng,
  state: MatchState,
  attacker: PieceState,
  defender: PieceState,
  skill: Skill,
  distance: number,
): DamageResolution {
  const preview = previewDamage(state, attacker, skill, distance);
  const rolled = rollInt(rng, preview.min, preview.max);

  const evadeRoll = rollDie(rng, 100);
  const evaded = evadeRoll <= effectiveEva(state, defender);

  return { preview, rolled, evadeRoll, evaded, dealt: evaded ? 0 : rolled };
}

/**
 * 치유 스킬의 예상 회복량 (신규 시스템).
 *
 * 공격 스킬과 달리 ATK·거리 감쇠·회피 판정을 적용하지 않는다 — 치유는 항상 적중해야
 * "아군을 살린다"는 의도가 배신당하지 않는다는 설계 결정이다.
 */
export function previewHeal(skill: Skill): DamageRange {
  return { min: skill.minDamage, max: skill.maxDamage };
}

/** 치유량 확정 굴림. */
export function resolveHeal(rng: Rng, skill: Skill): number {
  return rollInt(rng, skill.minDamage, skill.maxDamage);
}
