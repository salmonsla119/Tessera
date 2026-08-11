import { AP_PER_SPEED_TENTHS } from '@tessera/data';

/**
 * 행동력 누적 (GDD §2.2).
 *
 * ```
 * apPool += teamSpeed × 0.1
 * 이번 턴 행동 횟수 = floor(apPool)
 * apPool -= floor(apPool)      // 소수부만 이월
 * ```
 *
 * 0.1을 실수로 더하면 오차가 쌓여 이월값이 어긋나므로 1/10 단위 정수로 계산한다.
 */
export function accrueAp(
  carryTenths: number,
  teamSpeed: number,
): { ap: number; carryTenths: number } {
  const pool = carryTenths + teamSpeed * AP_PER_SPEED_TENTHS;
  return { ap: Math.floor(pool / 10), carryTenths: pool % 10 };
}

/** UI 표기용 — 이월분을 0.4 같은 소수 문자열로 (GDD §2.5). */
export function formatCarry(carryTenths: number): string {
  return (carryTenths / 10).toFixed(1);
}
