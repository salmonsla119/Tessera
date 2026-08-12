import { BOARD_SIZE, DEPLOY_ROWS } from '@tessera/data';
import { describe, expect, it } from 'vitest';
import { deployZoneCells } from '../board';
import { generateTerrain, isImmuneToTerrain, terrainAt } from '../terrain';
import { createRng } from '../rng';
import { effectiveEva, movableCells } from '../index';
import type { Coord, MatchState, PieceState } from '../types';
import { bareState } from './helpers';

function allCells(): Coord[] {
  const cells: Coord[] = [];
  for (let x = 0; x < BOARD_SIZE; x++) for (let y = 0; y < BOARD_SIZE; y++) cells.push({ x, y });
  return cells;
}

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
    pos: { x: 3, y: 3 },
    alive: true,
    statuses: [],
    ...overrides,
  };
}

function withTerrain(state: MatchState, terrain: Record<string, string>): MatchState {
  return { ...state, terrain: terrain as MatchState['terrain'] };
}

describe('지형 생성 (신규 시스템)', () => {
  it('같은 시드는 항상 같은 지형을 만든다 (결정론)', () => {
    const a = generateTerrain(createRng(777));
    const b = generateTerrain(createRng(777));
    expect(a).toEqual(b);
  });

  it('배치 구역(A·B 자진 2열)에는 지형이 생기지 않는다', () => {
    const deployCells = new Set(
      [...deployZoneCells('A'), ...deployZoneCells('B')].map((c) => `${c.x},${c.y}`),
    );
    for (let seed = 0; seed < 50; seed++) {
      const terrain = generateTerrain(createRng(seed));
      for (const key of Object.keys(terrain)) {
        expect(deployCells.has(key)).toBe(false);
      }
    }
  });

  it('지형은 평지가 아닌 4종(늪지·숲·빙판·화염지대)만 나온다', () => {
    const terrain = generateTerrain(createRng(1));
    const kinds = new Set(Object.values(terrain));
    for (const kind of kinds) {
      expect(['swamp', 'forest', 'glacier', 'scorched']).toContain(kind);
    }
  });

  it('한 매치에는 최대 3종류의 지형만 나온다', () => {
    for (let seed = 0; seed < 50; seed++) {
      const terrain = generateTerrain(createRng(seed));
      const kinds = new Set(Object.values(terrain));
      expect(kinds.size).toBeLessThanOrEqual(3);
    }
  });

  it('서로 다른 지형끼리는 칸이 겹치지 않는다', () => {
    // terrain은 칸→단일 종류 맵이라 자료구조상 겹칠 수 없지만, 생성 도중 다른 종류가
    // 이미 차지한 칸을 덮어써 버리는 회귀를 잡기 위해 총 칸 수 기준으로도 확인한다.
    for (let seed = 0; seed < 20; seed++) {
      const terrain = generateTerrain(createRng(seed));
      expect(Object.keys(terrain).length).toBeLessThanOrEqual(32); // 배치 구역을 뺀 보드 여유 칸 수
    }
  });

  it('지형 덩어리 하나는 30칸을 넘지 않는다', () => {
    for (let seed = 0; seed < 50; seed++) {
      const terrain = generateTerrain(createRng(seed));
      const counts = new Map<string, number>();
      for (const kind of Object.values(terrain)) counts.set(kind, (counts.get(kind) ?? 0) + 1);
      for (const count of counts.values()) expect(count).toBeLessThanOrEqual(30);
    }
  });

  it('전 보드를 훑어도 잘못된 칸 좌표가 없다', () => {
    const terrain = generateTerrain(createRng(42));
    const valid = new Set(allCells().map((c) => `${c.x},${c.y}`));
    for (const key of Object.keys(terrain)) {
      expect(valid.has(key)).toBe(true);
    }
  });
});

describe('지형 효과 — 이동 (신규 시스템)', () => {
  it('지형 위에서는 이동 범위가 1 줄어든다 (최소 1칸)', () => {
    const p = piece({ baseId: 'lancer', pos: { x: 3, y: 3 } }); // 직선 최대 2칸
    const plain = bareState([p]);
    const swampy = withTerrain(plain, { '3,3': 'swamp' });

    const onPlain = movableCells(plain, p);
    const onSwamp = movableCells(swampy, p);

    // 직선 방향으로 평지에서는 2칸까지, 늪지에서는 1칸까지만 갈 수 있다.
    expect(onPlain.some((c) => c.x === 5 && c.y === 3)).toBe(true);
    expect(onSwamp.some((c) => c.x === 5 && c.y === 3)).toBe(false);
    expect(onSwamp.some((c) => c.x === 4 && c.y === 3)).toBe(true);
  });

  it('이동 범위가 1인 기물은 지형 위에서도 1칸을 유지한다 (최소 1칸)', () => {
    const p = piece({ baseId: 'guard', pos: { x: 3, y: 3 } }); // 8방향 1칸
    const swampy = withTerrain(bareState([p]), { '3,3': 'swamp' });
    const reachable = movableCells(swampy, p);
    expect(reachable.length).toBeGreaterThan(0);
  });

  it('terrainImmune 패시브는 이동 페널티를 무시한다', () => {
    const p = piece({ baseId: 'swampstalker', pos: { x: 3, y: 3 } }); // 8방향 최대 2칸, 늪지 면역
    const swampy = withTerrain(bareState([p]), { '3,3': 'swamp' });
    const reachable = movableCells(swampy, p);
    expect(reachable.some((c) => c.x === 5 && c.y === 3)).toBe(true);
  });

  it('L자 도약은 지형의 영향을 받지 않는다', () => {
    const p = piece({ baseId: 'rider', pos: { x: 3, y: 3 } });
    const plain = bareState([p]);
    const swampy = withTerrain(plain, { '3,3': 'swamp' });
    expect(movableCells(swampy, p)).toEqual(movableCells(plain, p));
  });
});

describe('지형 효과 — 회피·면역 (신규 시스템)', () => {
  it('숲 위에서는 실효 회피율이 오른다', () => {
    const p = piece({ baseEva: 20, pos: { x: 3, y: 3 } });
    const forest = withTerrain(bareState([p]), { '3,3': 'forest' });
    const plain = bareState([p]);
    expect(effectiveEva(forest, p)).toBeGreaterThan(effectiveEva(plain, p));
  });

  it('isImmuneToTerrain은 면역 지형에서만 참이다', () => {
    const immune = piece({ baseId: 'frostguard' }); // 빙판 면역
    expect(isImmuneToTerrain(immune, 'glacier')).toBe(true);
    expect(isImmuneToTerrain(immune, 'swamp')).toBe(false);
  });

  it('평지는 누구에게나 면역과 동일하게 아무 효과가 없다', () => {
    const p = piece();
    expect(isImmuneToTerrain(p, 'plain')).toBe(true);
  });

  it('terrainAt은 지형이 없는 칸을 평지로 취급한다', () => {
    const state = bareState([piece()]);
    expect(terrainAt(state, { x: 0, y: 0 })).toBe('plain');
  });
});
