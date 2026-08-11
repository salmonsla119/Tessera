import { requireSkill } from '@tessera/data';
import { describe, expect, it } from 'vitest';
import { isSkillLocked, targetableCells, usableSkills, validTargets } from '../targeting';
import { cellSet, deck, pieceOf, place, startedMatch } from './helpers';

const DECK_A = deck('A', ['ranger', 'pierce'], ['acolyte', 'arc'], ['warlord', 'hex'], ['guard', 'bolt']);
const DECK_B = deck('B', ['guard', 'cleave'], ['guard', 'cleave'], ['guard', 'cleave']);

function board(layout: Record<string, { x: number; y: number } | null>) {
  return place(startedMatch(DECK_A, DECK_B), layout);
}

describe('사거리 형태 (GDD §6)', () => {
  it('인접은 8방향 1칸이다', () => {
    const state = board({ A0: { x: 3, y: 3 } });
    const cells = cellSet(targetableCells(state, { x: 3, y: 3 }, requireSkill('basic')));
    expect(cells.size).toBe(8);
    expect(cells.has('4,4')).toBe(true);
    expect(cells.has('3,5')).toBe(false);
  });

  it('관통사격은 직선상 첫 대상까지만 닿는다', () => {
    // 순찰자 (3,0) → 위쪽 직선. (3,2)에 적, (3,3)에 또 다른 적.
    const state = board({ A0: { x: 3, y: 0 }, B0: { x: 3, y: 2 }, B1: { x: 3, y: 3 } });
    const targets = validTargets(state, pieceOf(state, 'A0'), requireSkill('pierce')).map((p) => p.id);
    expect(targets).toContain('B0');
    expect(targets).not.toContain('B1'); // 앞의 적에 가려진다
  });

  it('아군이 직선을 막으면 뒤의 적을 때릴 수 없다', () => {
    const state = board({ A0: { x: 3, y: 0 }, A3: { x: 3, y: 1 }, B0: { x: 3, y: 2 } });
    const targets = validTargets(state, pieceOf(state, 'A0'), requireSkill('pierce')).map((p) => p.id);
    expect(targets).not.toContain('B0');
  });

  it('관통사격은 대각선으로는 나가지 않는다', () => {
    const state = board({ A0: { x: 3, y: 3 } });
    const cells = cellSet(targetableCells(state, { x: 3, y: 3 }, requireSkill('pierce')));
    expect(cells.has('3,6')).toBe(true);
    expect(cells.has('4,4')).toBe(false);
  });

  it('곡사는 경로를 무시하고 체비셰프 4칸 안을 전부 때린다', () => {
    // 사방이 막혀 있어도 포물선으로 넘어간다.
    const state = board({
      A1: { x: 3, y: 3 },
      A0: { x: 3, y: 4 },
      B0: { x: 3, y: 6 },
      B1: { x: 6, y: 6 },
    });
    const targets = validTargets(state, pieceOf(state, 'A1'), requireSkill('arc')).map((p) => p.id);
    expect(targets).toEqual(expect.arrayContaining(['B0', 'B1']));
  });

  it('곡사도 사거리 밖은 때리지 못한다', () => {
    const state = board({ A1: { x: 0, y: 0 }, B0: { x: 5, y: 5 } });
    expect(validTargets(state, pieceOf(state, 'A1'), requireSkill('arc'))).toEqual([]);
  });

  it('저주는 대각선으로만 나간다', () => {
    const state = board({ A2: { x: 3, y: 3 }, B0: { x: 5, y: 5 }, B1: { x: 3, y: 5 } });
    const targets = validTargets(state, pieceOf(state, 'A2'), requireSkill('hex')).map((p) => p.id);
    expect(targets).toEqual(['B0']);
  });

  it('마력탄은 8방향 2칸이다', () => {
    const state = board({ A3: { x: 3, y: 3 }, B0: { x: 5, y: 5 }, B1: { x: 6, y: 6 } });
    const targets = validTargets(state, pieceOf(state, 'A3'), requireSkill('bolt')).map((p) => p.id);
    expect(targets).toEqual(['B0']);
  });

  it('아군은 공격 대상이 아니다', () => {
    const state = board({ A0: { x: 3, y: 3 }, A3: { x: 3, y: 4 } });
    expect(validTargets(state, pieceOf(state, 'A0'), requireSkill('basic'))).toEqual([]);
  });
});

describe('SP에 따른 스킬 잠금 (GDD §4)', () => {
  it('SP가 충분하면 기본 공격과 편성 스킬을 모두 쓸 수 있다', () => {
    const state = board({ A0: { x: 3, y: 3 } });
    const piece = pieceOf(state, 'A0'); // ranger, SP 10, pierce는 4 필요
    expect(usableSkills(piece).map((s) => s.id)).toEqual(['basic', 'pierce']);
    expect(isSkillLocked(piece)).toBe(false);
  });

  it('SP가 코스트 미만이면 스킬이 잠기고 기본 공격만 남는다', () => {
    const state = board({ A0: { x: 3, y: 3 } });
    const piece = { ...pieceOf(state, 'A0'), sp: 3 };
    expect(usableSkills(piece).map((s) => s.id)).toEqual(['basic']);
    expect(isSkillLocked(piece)).toBe(true);
  });
});
