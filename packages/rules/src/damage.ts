import { DISTANCE_FALLOFF, DISTANCE_FALLOFF_MIN, type Skill } from '@tessera/data';
import { rollDie, rollInt, type Rng } from './rng';
import { effectiveEva } from './state';
import type { DamageRange, PieceState } from './types';

/** 거리 감쇠 배율, 체비셰프 거리 기준 (GDD §3.2). 5칸 이상은 전부 0.40. */
export function distanceMultiplier(distance: number): number {
  return DISTANCE_FALLOFF[distance] ?? DISTANCE_FALLOFF_MIN;
}

/**
 * 데미지 파이프라인 1~3단계 (GDD §3.1) — 플레이어에게 표시되는 "예상 데미지".
 *
 * ```
 * [minD, maxD] → +ATK → ×거리배율(양 끝값 반올림)
 * ```
 *
 * 클라이언트가 이 함수를 그대로 호출해 미리보기를 그리므로 서버 계산과 어긋나지 않는다.
 */
export function previewDamage(attacker: PieceState, skill: Skill, distance: number): DamageRange {
  const multiplier = distanceMultiplier(distance);
  const min = Math.max(0, Math.round((skill.minDamage + attacker.atk) * multiplier));
  const max = Math.max(min, Math.round((skill.maxDamage + attacker.atk) * multiplier));
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
  attacker: PieceState,
  defender: PieceState,
  skill: Skill,
  distance: number,
): DamageResolution {
  const preview = previewDamage(attacker, skill, distance);
  const rolled = rollInt(rng, preview.min, preview.max);

  const evadeRoll = rollDie(rng, 100);
  const evaded = evadeRoll <= effectiveEva(defender);

  return { preview, rolled, evadeRoll, evaded, dealt: evaded ? 0 : rolled };
}
