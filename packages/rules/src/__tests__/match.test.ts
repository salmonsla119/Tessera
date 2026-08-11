import { SUDDEN_DEATH_ROUND } from '@tessera/data';
import { describe, expect, it } from 'vitest';
import { legalActions } from '../actions';
import { mulberry32 } from '../rng';
import { IllegalActionError, applyAction } from '../resolve';
import { createMatch, livingPieces } from '../state';
import type { Action, MatchState } from '../types';
import { autoDeployAction, deck, pieceOf, place, startedMatch } from './helpers';

const DECK_A = deck('A', ['guard', 'cleave'], ['ranger', 'pierce'], ['rider', 'smite']);
const DECK_B = deck('B', ['lancer', 'bolt'], ['acolyte', 'hex'], ['warlord', 'rend']);

/** 무작위 합법 수를 두면서 매치를 끝까지 진행하고 액션 로그를 남긴다. */
function playRecorded(seed: number): { state: MatchState; log: Action[] } {
  const rand = mulberry32(seed);
  let state = createMatch(DECK_A, DECK_B, seed);
  const log: Action[] = [];

  const push = (action: Action) => {
    log.push(action);
    state = applyAction(state, action).state;
  };

  push(autoDeployAction(state, 'A'));
  push(autoDeployAction(state, 'B'));

  let guard = 0;
  while (state.phase !== 'finished' && guard++ < 5000) {
    const actions = legalActions(state, state.turnOwner);
    push(actions[Math.floor(rand() * actions.length)]!);
  }
  return { state, log };
}

describe('결정론 (PLAN §8.1)', () => {
  it('같은 시드 + 같은 액션 로그를 리플레이하면 최종 상태가 동일하다', () => {
    const { state, log } = playRecorded(42);

    let replayed = createMatch(DECK_A, DECK_B, 42);
    for (const action of log) replayed = applyAction(replayed, action).state;

    expect(JSON.stringify(replayed)).toBe(JSON.stringify(state));
  });

  it('같은 시드로 두 번 플레이하면 같은 결과가 나온다', () => {
    expect(JSON.stringify(playRecorded(7).state)).toBe(JSON.stringify(playRecorded(7).state));
  });

  it('applyAction은 입력 상태를 변형하지 않는다', () => {
    const state = startedMatch(DECK_A, DECK_B);
    const before = JSON.stringify(state);
    applyAction(state, { type: 'endTurn', player: state.turnOwner });
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('팀 속도 불변 (GDD §2.2)', () => {
  it('기물이 죽어도 teamSpeed가 줄지 않는다', () => {
    const initial = createMatch(DECK_A, DECK_B, 3);
    const { state } = playRecorded(3);

    expect(livingPieces(state, 'A').length + livingPieces(state, 'B').length).toBeLessThan(6);
    expect(state.teamSpeed).toEqual(initial.teamSpeed);
  });

  it('teamSpeed는 덱 SPD 합과 같다', () => {
    const state = createMatch(DECK_A, DECK_B, 1);
    expect(state.teamSpeed.A).toBe(6 + 11 + 12); // guard + ranger + rider
    expect(state.teamSpeed.B).toBe(9 + 8 + 14); // lancer + acolyte + warlord
  });
});

describe('매치 시작 (GDD §8.1, §8.4)', () => {
  it('후공만 시작 apPool에 +0.5를 받는다', () => {
    const state = createMatch(DECK_A, DECK_B, 5);
    const second = state.first === 'A' ? 'B' : 'A';
    expect(state.apPoolTenths[state.first]).toBe(0);
    expect(state.apPoolTenths[second]).toBe(5);
  });

  it('양측이 배치를 제출해야 전투가 시작된다', () => {
    let state = createMatch(DECK_A, DECK_B, 5);
    state = applyAction(state, autoDeployAction(state, 'A')).state;
    expect(state.phase).toBe('deploying');

    const result = applyAction(state, autoDeployAction(state, 'B'));
    expect(result.state.phase).toBe('battle');
    expect(result.events.map((e) => e.type)).toContain('BattleStarted');
    expect(result.state.turnOwner).toBe(result.state.first);
  });

  it('자진 구역 밖 배치는 거부된다', () => {
    const state = createMatch(DECK_A, DECK_B, 5);
    const own = state.pieces.filter((p) => p.owner === 'A');
    const action: Action = {
      type: 'deploy',
      player: 'A',
      placements: own.map((p, i) => ({ pieceId: p.id, pos: { x: i, y: 4 } })),
    };
    expect(() => applyAction(state, action)).toThrow(IllegalActionError);
  });

  it('한 칸에 두 기물을 배치할 수 없다', () => {
    const state = createMatch(DECK_A, DECK_B, 5);
    const own = state.pieces.filter((p) => p.owner === 'A');
    const action: Action = {
      type: 'deploy',
      player: 'A',
      placements: own.map((p) => ({ pieceId: p.id, pos: { x: 0, y: 0 } })),
    };
    expect(() => applyAction(state, action)).toThrow(IllegalActionError);
  });
});

describe('행동력 소비 (GDD §2.4)', () => {
  it('한 기물에 AP를 몰아 쓸 수 있다 — 기물당 횟수 제한이 없다', () => {
    let state = startedMatch(DECK_A, DECK_B, 11);
    const player = state.turnOwner;
    const startAp = state.ap[player];
    expect(startAp).toBeGreaterThanOrEqual(2);

    const mover = livingPieces(state, player)[0]!;
    const first = legalActions(state, player).find(
      (a): a is Extract<Action, { type: 'move' }> => a.type === 'move' && a.pieceId === mover.id,
    )!;
    state = applyAction(state, first).state;
    expect(state.ap[player]).toBe(startAp - 1);

    const second = legalActions(state, player).find(
      (a): a is Extract<Action, { type: 'move' }> => a.type === 'move' && a.pieceId === mover.id,
    )!;
    state = applyAction(state, second).state;
    expect(state.ap[player]).toBe(startAp - 2);
  });

  it('AP를 다 쓰면 턴이 자동으로 넘어간다', () => {
    let state = startedMatch(DECK_A, DECK_B, 11);
    const player = state.turnOwner;
    while (state.ap[player] > 0 && state.turnOwner === player) {
      const move = legalActions(state, player).find((a) => a.type === 'move')!;
      state = applyAction(state, move).state;
    }
    expect(state.turnOwner).not.toBe(player);
  });

  it('속도 합이 10 미만이면 첫 턴 행동 횟수가 0이 될 수 있다', () => {
    // 방패병 1기 = SPD 6 → 0.6 AP. 선공은 이번 턴에 아무것도 못 한다.
    const slowA = deck('slowA', ['guard', 'cleave']);
    const slowB = deck('slowB', ['guard', 'cleave']);
    const state = startedMatch(slowA, slowB, 1);
    expect(state.turnOwner).toBe(state.first);
    expect(state.ap[state.first]).toBe(0);

    const actions = legalActions(state, state.first);
    expect(actions).toEqual([{ type: 'endTurn', player: state.first }]);
  });

  it('상대 턴에는 행동할 수 없다', () => {
    const state = startedMatch(DECK_A, DECK_B, 11);
    const opponent = state.turnOwner === 'A' ? 'B' : 'A';
    expect(() => applyAction(state, { type: 'endTurn', player: opponent })).toThrow(IllegalActionError);
  });
});

describe('정신력 (GDD §4)', () => {
  it('집중은 AP 1을 써서 SP를 3 올린다', () => {
    let state = startedMatch(DECK_A, DECK_B, 11);
    const player = state.turnOwner;
    const target = livingPieces(state, player)[0]!;

    // 집중이 합법이 되도록 SP를 깎아 둔다.
    state = { ...state, pieces: state.pieces.map((p) => (p.id === target.id ? { ...p, sp: 0 } : p)) };

    const result = applyAction(state, { type: 'focus', player, pieceId: target.id });
    expect(pieceOf(result.state, target.id).sp).toBe(3);
    expect(result.events.map((e) => e.type)).toContain('Focused');
  });

  it('SP가 최대인 기물은 집중할 수 없다', () => {
    const state = startedMatch(DECK_A, DECK_B, 11);
    const player = state.turnOwner;
    const full = livingPieces(state, player).find((p) => p.sp === p.maxSp)!;
    expect(() => applyAction(state, { type: 'focus', player, pieceId: full.id })).toThrow(IllegalActionError);
  });

  it('턴 시작마다 SP가 1씩 회복된다', () => {
    let state = startedMatch(DECK_A, DECK_B, 11);
    const player = state.turnOwner;
    const target = livingPieces(state, player)[0]!;
    state = { ...state, pieces: state.pieces.map((p) => (p.id === target.id ? { ...p, sp: 0 } : p)) };

    state = applyAction(state, { type: 'endTurn', player }).state;
    state = applyAction(state, { type: 'endTurn', player: state.turnOwner }).state;

    expect(state.turnOwner).toBe(player);
    expect(pieceOf(state, target.id).sp).toBe(1);
  });
});

describe('승리 조건 (GDD §8.3)', () => {
  it('상대 기물을 전멸시키면 승리한다', () => {
    let state = startedMatch(DECK_A, DECK_B, 11);
    const player = state.turnOwner;
    const opponent = player === 'A' ? 'B' : 'A';

    const attacker = livingPieces(state, player)[0]!;
    const victim = livingPieces(state, opponent)[0]!;

    // 공격자와 마지막 남은 적을 인접시키고, 적 HP를 1로 만든다.
    state = place(state, { [attacker.id]: { x: 3, y: 3 }, [victim.id]: { x: 3, y: 4 } });
    state = { ...state, pieces: state.pieces.map((p) => (p.id === victim.id ? { ...p, hp: 1, baseEva: 0 } : p)) };

    const result = applyAction(state, {
      type: 'attack',
      player,
      pieceId: attacker.id,
      skillId: 'basic',
      targetId: victim.id,
    });

    expect(result.state.phase).toBe('finished');
    expect(result.state.winner).toBe(player);
    expect(result.events.map((e) => e.type)).toEqual(expect.arrayContaining(['PieceDown', 'MatchEnded']));
  });
});

describe('서든데스 (GDD §8.4)', () => {
  it('40라운드가 지나면 매 턴 시작 시 전 기물이 2씩 깎이고 매치가 끝난다', () => {
    let state = startedMatch(DECK_A, DECK_B, 11);
    let guard = 0;

    // 양측이 계속 턴만 넘기면 서든데스만이 매치를 끝낼 수 있다.
    while (state.phase !== 'finished' && guard++ < 1000) {
      state = applyAction(state, { type: 'endTurn', player: state.turnOwner }).state;
    }

    expect(state.phase).toBe('finished');
    expect(state.suddenDeath).toBe(true);
    expect(state.round).toBeGreaterThan(SUDDEN_DEATH_ROUND);
  });

  it('서든데스 이전에는 HP가 저절로 줄지 않는다', () => {
    let state = startedMatch(DECK_A, DECK_B, 11);
    for (let i = 0; i < 10; i++) {
      state = applyAction(state, { type: 'endTurn', player: state.turnOwner }).state;
    }
    expect(state.suddenDeath).toBe(false);
    expect(state.pieces.every((p) => p.hp === p.maxHp)).toBe(true);
  });
});

describe('부가 효과', () => {
  it('저주는 대상 EVA를 2턴간 10 낮춘다', () => {
    let state = startedMatch(DECK_A, DECK_B, 11);
    const caster = state.pieces.find((p) => p.skillId === 'hex')!;
    const player = caster.owner;
    const opponent = player === 'A' ? 'B' : 'A';
    const victim = livingPieces(state, opponent)[0]!;

    state = place(state, { [caster.id]: { x: 3, y: 3 }, [victim.id]: { x: 4, y: 4 } });
    state = {
      ...state,
      turnOwner: player,
      ap: { ...state.ap, [player]: 3 },
      // 회피로 빗나가면 효과가 붙지 않으므로 회피를 0으로 고정한다.
      pieces: state.pieces.map((p) => (p.id === victim.id ? { ...p, baseEva: 0 } : p)),
    };

    const result = applyAction(state, {
      type: 'attack',
      player,
      pieceId: caster.id,
      skillId: 'hex',
      targetId: victim.id,
    });

    expect(pieceOf(result.state, victim.id).statuses).toEqual([
      { kind: 'evaDown', value: 10, turnsLeft: 2 },
    ]);
  });

  it('절단은 대상 SP를 3 깎는다', () => {
    let state = startedMatch(DECK_A, DECK_B, 11);
    const attacker = state.pieces.find((p) => p.skillId === 'rend')!;
    const player = attacker.owner;
    const opponent = player === 'A' ? 'B' : 'A';
    const victim = livingPieces(state, opponent)[0]!;
    const spBefore = victim.sp;

    state = place(state, { [attacker.id]: { x: 3, y: 3 }, [victim.id]: { x: 3, y: 4 } });
    state = {
      ...state,
      turnOwner: player,
      ap: { ...state.ap, [player]: 3 },
      pieces: state.pieces.map((p) => (p.id === victim.id ? { ...p, baseEva: 0, hp: 999, maxHp: 999 } : p)),
    };

    const result = applyAction(state, {
      type: 'attack',
      player,
      pieceId: attacker.id,
      skillId: 'rend',
      targetId: victim.id,
    });

    expect(pieceOf(result.state, victim.id).sp).toBe(Math.max(0, spBefore - 3));
  });
});
