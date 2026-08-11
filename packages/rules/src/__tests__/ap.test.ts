import { describe, expect, it } from 'vitest';
import { accrueAp, formatCarry } from '../ap';

describe('행동력 누적 (GDD §2.2)', () => {
  it('속도 합 27 팀의 5턴 진행이 GDD §2.3 표와 일치한다', () => {
    const expected = [
      { ap: 2, carryTenths: 7 },
      { ap: 3, carryTenths: 4 },
      { ap: 3, carryTenths: 1 },
      { ap: 2, carryTenths: 8 },
      { ap: 3, carryTenths: 5 },
    ];

    let carry = 0;
    for (const step of expected) {
      const result = accrueAp(carry, 27);
      expect(result).toEqual(step);
      carry = result.carryTenths;
    }
  });

  it('소수 이월이 부동소수 오차 없이 누적된다', () => {
    // 0.1을 실수로 100번 더하면 10에 도달하지 못한다. 정수 누적이면 정확히 맞는다.
    let carry = 0;
    let total = 0;
    for (let turn = 0; turn < 100; turn++) {
      const result = accrueAp(carry, 10);
      total += result.ap;
      carry = result.carryTenths;
    }
    expect(total).toBe(100);
    expect(carry).toBe(0);
  });

  it('후공 보정 +0.5는 첫 턴 행동 횟수를 한 번 끌어올릴 수 있다', () => {
    // 속도 15 → 매 턴 1.5. 보정 없으면 1회, 보정 있으면 2회.
    expect(accrueAp(0, 15).ap).toBe(1);
    expect(accrueAp(5, 15).ap).toBe(2);
  });

  it('이월분을 소수 문자열로 표기한다 (GDD §2.5)', () => {
    expect(formatCarry(4)).toBe('0.4');
    expect(formatCarry(0)).toBe('0.0');
  });
});
