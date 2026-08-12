import { requireSkill } from '@tessera/data';
import { describe, expect, it } from 'vitest';
import { distanceMultiplier, previewDamage, resolveDamage } from '../damage';
import { createRng } from '../rng';
import { effectiveEva } from '../state';
import type { PieceState } from '../types';
import { bareState } from './helpers';

function piece(overrides: Partial<PieceState> = {}): PieceState {
  return {
    id: 'X',
    owner: 'A',
    baseId: 'guard',
    skillId: 'basic',
    hp: 30,
    maxHp: 30,
    sp: 10,
    maxSp: 10,
    atk: 0,
    baseEva: 0,
    spd: 10,
    pos: { x: 0, y: 0 },
    alive: true,
    statuses: [],
    ...overrides,
  };
}

describe('데미지 파이프라인 (GDD §3.1)', () => {
  const pierce = requireSkill('pierce');

  it('ATK 5 + 관통사격(2~7)은 거리1에서 7~12', () => {
    const attacker = piece({ atk: 5 });
    expect(previewDamage(bareState([attacker]), attacker, pierce, 1)).toEqual({ min: 7, max: 12 });
  });

  it('ATK 5 + 관통사격(2~7)은 거리3에서 5~8', () => {
    // (2+5)×0.70 = 4.9 → 5, (7+5)×0.70 = 8.4 → 8
    const attacker = piece({ atk: 5 });
    expect(previewDamage(bareState([attacker]), attacker, pierce, 3)).toEqual({ min: 5, max: 8 });
  });

  it('거리 감쇠 배율이 GDD §3.2 표와 일치한다', () => {
    expect(distanceMultiplier(1)).toBe(1.0);
    expect(distanceMultiplier(2)).toBe(0.85);
    expect(distanceMultiplier(3)).toBe(0.7);
    expect(distanceMultiplier(4)).toBe(0.55);
    expect(distanceMultiplier(5)).toBe(0.4);
    expect(distanceMultiplier(9)).toBe(0.4);
  });

  it('확정 데미지는 항상 예상 범위 안에 들어온다', () => {
    const attacker = piece({ atk: 5 });
    const defender = piece({ id: 'Y', owner: 'B', baseEva: 0 });
    const state = bareState([attacker, defender]);
    for (let seed = 0; seed < 200; seed++) {
      const result = resolveDamage(createRng(seed), state, attacker, defender, pierce, 2);
      expect(result.rolled).toBeGreaterThanOrEqual(result.preview.min);
      expect(result.rolled).toBeLessThanOrEqual(result.preview.max);
    }
  });

  it('회피하면 데미지가 통째로 0이 된다', () => {
    const attacker = piece({ atk: 5 });
    // EVA 60(상한)인 방어자로 여러 번 굴려 회피 사례를 확보한다.
    const defender = piece({ id: 'Y', owner: 'B', baseEva: 60 });
    const state = bareState([attacker, defender]);
    const evaded = [];
    for (let seed = 0; seed < 200; seed++) {
      const result = resolveDamage(createRng(seed), state, attacker, defender, pierce, 1);
      if (result.evaded) evaded.push(result);
    }
    expect(evaded.length).toBeGreaterThan(0);
    for (const result of evaded) {
      expect(result.dealt).toBe(0);
      expect(result.rolled).toBeGreaterThan(0); // 굴림 자체는 일어났고, 회피가 그걸 지웠다
    }
  });
});

describe('회피 상한 (GDD §3.3)', () => {
  it('EVA 80 기물의 실효 회피율이 60%로 잘린다', () => {
    const p = piece({ baseEva: 80 });
    expect(effectiveEva(bareState([p]), p)).toBe(60);
  });

  it('저주(EVA −10)가 실효 회피율을 낮춘다', () => {
    const cursed = piece({ baseEva: 25, statuses: [{ kind: 'evaDown', value: 10, turnsLeft: 2 }] });
    expect(effectiveEva(bareState([cursed]), cursed)).toBe(15);
  });

  it('실효 회피율은 0 밑으로 내려가지 않는다', () => {
    const cursed = piece({ baseEva: 5, statuses: [{ kind: 'evaDown', value: 10, turnsLeft: 2 }] });
    expect(effectiveEva(bareState([cursed]), cursed)).toBe(0);
  });

  it('실효 회피율이 0이면 절대 회피하지 않는다', () => {
    const attacker = piece({ atk: 5 });
    const defender = piece({ id: 'Y', owner: 'B', baseEva: 0 });
    const state = bareState([attacker, defender]);
    for (let seed = 0; seed < 300; seed++) {
      expect(resolveDamage(createRng(seed), state, attacker, defender, requireSkill('basic'), 1).evaded).toBe(false);
    }
  });
});
