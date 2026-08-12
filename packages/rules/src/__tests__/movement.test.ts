import { describe, expect, it } from 'vitest';
import { movableCells } from '../movement';
import { cellSet, deck, pieceOf, place, startedMatch } from './helpers';

const DECK_A = deck('A', ['guard', 'cleave'], ['lancer', 'cleave'], ['rider', 'cleave'], ['acolyte', 'cleave'], ['warlord', 'cleave']);
const DECK_B = deck('B', ['guard', 'cleave'], ['guard', 'cleave']);

// 순수 이동 패턴만 확인하는 테스트라 지형은 끈다 — 지형 자체는 terrain.test.ts에서 별도로 검증한다.
// (더 커진 지형 덩어리(13~30칸, packages/data/src/constants.ts)가 기물의 시작 칸을 덮으면
// 이동 범위가 의도치 않게 줄어들어 여기 있는 순수 패턴 기대값이 깨진다.)
function board(layout: Record<string, { x: number; y: number } | null>) {
  return place({ ...startedMatch(DECK_A, DECK_B), terrain: {} }, layout);
}

describe('이동 (GDD §5)', () => {
  it('방패병은 8방향 1칸으로 움직인다', () => {
    const state = board({ A0: { x: 3, y: 3 } });
    const cells = cellSet(movableCells(state, pieceOf(state, 'A0')));
    expect(cells.size).toBe(8);
    expect(cells.has('2,2')).toBe(true);
    expect(cells.has('4,4')).toBe(true);
    expect(cells.has('3,5')).toBe(false);
  });

  it('보드 밖으로는 나가지 못한다', () => {
    const state = board({ A0: { x: 0, y: 0 } });
    const cells = cellSet(movableCells(state, pieceOf(state, 'A0')));
    expect(cells.size).toBe(3);
    expect([...cells].sort()).toEqual(['0,1', '1,0', '1,1']);
  });

  it('창병의 직선 이동은 경로 중간 기물에 막힌다', () => {
    // 창병 (3,3), 아군 방패병 (3,5). 직선 최대 2칸이므로 (3,4)까지만 간다.
    const state = board({ A1: { x: 3, y: 3 }, A0: { x: 3, y: 5 } });
    const cells = cellSet(movableCells(state, pieceOf(state, 'A1')));
    expect(cells.has('3,4')).toBe(true);
    expect(cells.has('3,5')).toBe(false);
    expect(cells.has('1,3')).toBe(true); // 다른 방향은 정상
  });

  it('막는 기물이 적이어도 그 칸에는 설 수 없다', () => {
    const state = board({ A1: { x: 3, y: 3 }, B0: { x: 3, y: 4 } });
    const cells = cellSet(movableCells(state, pieceOf(state, 'A1')));
    expect(cells.has('3,4')).toBe(false);
    expect(cells.has('3,5')).toBe(false); // 뒤쪽도 막힌다
  });

  it('사제의 대각 이동은 최대 3칸이며 대각 경로가 막히면 멈춘다', () => {
    const state = board({ A3: { x: 0, y: 0 }, A0: { x: 2, y: 2 } });
    const cells = cellSet(movableCells(state, pieceOf(state, 'A3')));
    expect(cells.has('1,1')).toBe(true);
    expect(cells.has('2,2')).toBe(false);
    expect(cells.has('3,3')).toBe(false);
    expect(cells.has('1,0')).toBe(false); // 직선은 애초에 못 간다
  });

  it('기병의 L자 도약은 다른 기물을 넘어간다', () => {
    // 기병을 완전히 둘러싸도 도약 목적지가 비어 있으면 갈 수 있다.
    const state = board({
      A2: { x: 3, y: 3 },
      A0: { x: 3, y: 4 },
      A1: { x: 4, y: 3 },
      B0: { x: 2, y: 3 },
      B1: { x: 3, y: 2 },
    });
    const cells = cellSet(movableCells(state, pieceOf(state, 'A2')));
    expect(cells.has('4,5')).toBe(true);
    expect(cells.has('5,4')).toBe(true);
    expect(cells.size).toBe(8);
  });

  it('기병은 기물이 서 있는 칸에는 착지하지 못한다', () => {
    const state = board({ A2: { x: 3, y: 3 }, A0: { x: 4, y: 5 } });
    const cells = cellSet(movableCells(state, pieceOf(state, 'A2')));
    expect(cells.has('4,5')).toBe(false);
    expect(cells.size).toBe(7);
  });

  it('장군은 8방향 최대 3칸까지 가고 경로 차단을 받는다', () => {
    const state = board({ A4: { x: 3, y: 3 }, A0: { x: 3, y: 5 } });
    const cells = cellSet(movableCells(state, pieceOf(state, 'A4')));
    expect(cells.has('3,4')).toBe(true);
    expect(cells.has('3,5')).toBe(false);
    expect(cells.has('3,6')).toBe(false);
    expect(cells.has('6,6')).toBe(true); // 대각 3칸
    expect(cells.has('7,7')).toBe(false); // 4칸은 사거리 밖
  });

  it('전사한 기물은 움직일 수 없다', () => {
    const state = board({ A0: { x: 3, y: 3 }, A1: null });
    expect(movableCells(state, pieceOf(state, 'A1'))).toEqual([]);
  });
});
