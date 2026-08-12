import { describe, expect, it } from 'vitest';
import { applyAction } from '../resolve';
import { legalActions } from '../actions';
import { effectiveAtk, getPiece, isFrozen } from '../state';
import { auraHealTargets, isImmuneToStatus } from '../passives';
import { deck, place, startedMatch } from './helpers';
import type { MatchState } from '../types';

/** 지형이 결과에 끼어들지 않게 늘 걷어낸다 — 이 파일은 상태이상·패시브만 본다. */
function noTerrain(state: MatchState): MatchState {
  return { ...state, terrain: {} };
}

describe('상태이상 — 화상·출혈 (신규 시스템)', () => {
  it('화상은 대상 턴 시작마다 고정 피해를 주고 지속시간이 줄어든다', () => {
    let state = noTerrain(startedMatch(deck('A', ['pyromancer', 'scorch'], ['guard', 'cleave']), deck('B', ['lancer', 'bolt'])));
    const casterId = state.pieces.find((p) => p.skillId === 'scorch')!.id;
    const targetId = state.pieces.find((p) => p.owner === 'B')!.id;
    state = place(state, { [casterId]: { x: 3, y: 3 }, [targetId]: { x: 4, y: 3 } });
    state = { ...state, pieces: state.pieces.map((p) => (p.id === targetId ? { ...p, baseEva: 0 } : p)) };

    const result = applyAction(state, { type: 'attack', player: 'A', pieceId: casterId, skillId: 'scorch', targetId });
    const burned = getPiece(result.state, targetId)!;
    expect(burned.statuses.some((s) => s.kind === 'burn')).toBe(true);
  });
});

describe('상태이상 — 빙결 (신규 시스템)', () => {
  it('빙결된 기물은 이동·공격·집중을 전부 할 수 없다', () => {
    let state = noTerrain(startedMatch(deck('A', ['pyromancer', 'frostbite'], ['guard', 'cleave']), deck('B', ['lancer', 'bolt'])));
    const casterId = state.pieces.find((p) => p.skillId === 'frostbite')!.id;
    const targetId = state.pieces.find((p) => p.owner === 'B')!.id;
    state = place(state, { [casterId]: { x: 3, y: 3 }, [targetId]: { x: 4, y: 3 } });
    state = { ...state, pieces: state.pieces.map((p) => (p.id === targetId ? { ...p, baseEva: 0 } : p)) };

    const result = applyAction(state, { type: 'attack', player: 'A', pieceId: casterId, skillId: 'frostbite', targetId });
    const frozen = getPiece(result.state, targetId)!;
    expect(isFrozen(frozen)).toBe(true);

    const legal = legalActions(result.state, 'B');
    expect(new Set(legal.map((a) => a.type))).toEqual(new Set(['endTurn']));
  });

  it('statusImmune(freeze) 패시브가 있으면 빙결에 걸리지 않는다', () => {
    const shaman = { baseId: 'shaman' } as const;
    expect(isImmuneToStatus({ ...dummyPiece(), baseId: shaman.baseId }, 'freeze')).toBe(true);
    expect(isImmuneToStatus({ ...dummyPiece(), baseId: shaman.baseId }, 'burn')).toBe(false);
  });
});

describe('치유 스킬 (신규 시스템)', () => {
  it('아군을 대상으로 회복시키고 최대 HP를 넘지 않는다', () => {
    let state = noTerrain(startedMatch(deck('A', ['acolyte', 'heal'], ['guard', 'cleave']), deck('B', ['lancer', 'bolt'])));
    const healerId = state.pieces.find((p) => p.skillId === 'heal')!.id;
    const allyId = state.pieces.find((p) => p.owner === 'A' && p.skillId !== 'heal')!.id;
    state = place(state, { [healerId]: { x: 3, y: 3 }, [allyId]: { x: 3, y: 4 } });
    state = { ...state, pieces: state.pieces.map((p) => (p.id === allyId ? { ...p, hp: 1 } : p)) };

    const result = applyAction(state, { type: 'attack', player: 'A', pieceId: healerId, skillId: 'heal', targetId: allyId });
    const healed = getPiece(result.state, allyId)!;
    expect(healed.hp).toBeGreaterThan(1);
    expect(healed.hp).toBeLessThanOrEqual(healed.maxHp);
  });

  it('자기 자신도 치유 대상이 될 수 있다', () => {
    let state = noTerrain(startedMatch(deck('A', ['acolyte', 'heal'], ['guard', 'cleave']), deck('B', ['lancer', 'bolt'])));
    const healerId = state.pieces.find((p) => p.skillId === 'heal')!.id;
    state = { ...state, pieces: state.pieces.map((p) => (p.id === healerId ? { ...p, hp: 1 } : p)) };

    const result = applyAction(state, { type: 'attack', player: 'A', pieceId: healerId, skillId: 'heal', targetId: healerId });
    expect(getPiece(result.state, healerId)!.hp).toBeGreaterThan(1);
  });

  it('치유는 회피 판정 없이 항상 적중한다', () => {
    let state = noTerrain(startedMatch(deck('A', ['acolyte', 'heal'], ['guard', 'cleave']), deck('B', ['lancer', 'bolt'])));
    const healerId = state.pieces.find((p) => p.skillId === 'heal')!.id;
    const allyId = state.pieces.find((p) => p.owner === 'A' && p.skillId !== 'heal')!.id;
    state = place(state, { [healerId]: { x: 3, y: 3 }, [allyId]: { x: 3, y: 4 } });
    state = { ...state, pieces: state.pieces.map((p) => (p.id === allyId ? { ...p, hp: 1, baseEva: 60 } : p)) };

    for (let seed = 0; seed < 30; seed++) {
      const seeded = { ...state, seed, rngCursor: 0 };
      const result = applyAction(seeded, { type: 'attack', player: 'A', pieceId: healerId, skillId: 'heal', targetId: allyId });
      expect(getPiece(result.state, allyId)!.hp).toBeGreaterThan(1);
    }
  });

  it('checkAction은 치유 스킬로 적을 대상하는 것을 거부한다', () => {
    let state = noTerrain(startedMatch(deck('A', ['acolyte', 'heal'], ['guard', 'cleave']), deck('B', ['lancer', 'bolt'])));
    const healerId = state.pieces.find((p) => p.skillId === 'heal')!.id;
    const enemyId = state.pieces.find((p) => p.owner === 'B')!.id;
    state = place(state, { [healerId]: { x: 3, y: 3 }, [enemyId]: { x: 3, y: 4 } });

    expect(() =>
      applyAction(state, { type: 'attack', player: 'A', pieceId: healerId, skillId: 'heal', targetId: enemyId }),
    ).toThrow();
  });
});

describe('패시브 — 오라 (신규 시스템)', () => {
  it('auraHeal 패시브는 자기 턴 시작마다 반경 내 다친 아군을 회복시킨다', () => {
    let state = noTerrain(startedMatch(deck('A', ['paladin', 'cleave'], ['guard', 'cleave']), deck('B', ['lancer', 'bolt'])));
    const healerId = state.pieces.find((p) => p.baseId === 'paladin')!.id;
    const allyId = state.pieces.find((p) => p.owner === 'A' && p.baseId !== 'paladin')!.id;
    state = place(state, { [healerId]: { x: 3, y: 3 }, [allyId]: { x: 3, y: 4 } });
    state = { ...state, pieces: state.pieces.map((p) => (p.id === allyId ? { ...p, hp: 1 } : p)) };

    const healer = getPiece(state, healerId)!;
    const targets = auraHealTargets(state, healer);
    expect(targets.some((t) => t.targetId === allyId)).toBe(true);
  });

  it('auraBuff(atk) 패시브는 반경 내 아군의 실효 공격력을 올린다', () => {
    let state = noTerrain(startedMatch(deck('A', ['templar', 'cleave'], ['guard', 'cleave']), deck('B', ['lancer', 'bolt'])));
    const templarId = state.pieces.find((p) => p.baseId === 'templar')!.id;
    const allyId = state.pieces.find((p) => p.owner === 'A' && p.baseId !== 'templar')!.id;
    state = place(state, { [templarId]: { x: 3, y: 3 }, [allyId]: { x: 3, y: 4 } });

    const buffed = getPiece(state, allyId)!;
    const far = { ...state, pieces: state.pieces.map((p) => (p.id === templarId ? { ...p, pos: { x: 7, y: 7 } } : p)) };

    expect(effectiveAtk(state, buffed)).toBeGreaterThan(effectiveAtk(far, buffed));
  });
});

function dummyPiece() {
  return {
    id: 'X',
    owner: 'A' as const,
    baseId: 'guard',
    skillId: 'basic',
    hp: 10,
    maxHp: 10,
    sp: 10,
    maxSp: 10,
    atk: 1,
    baseEva: 0,
    spd: 1,
    pos: null,
    alive: true,
    statuses: [],
  };
}
