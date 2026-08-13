import { requireSkill } from '@tessera/data';
import { describe, expect, it } from 'vitest';
import { applyAction } from '../resolve';
import { getPiece } from '../state';
import { deck, place, startedMatch } from './helpers';
import type { MatchState } from '../types';

/** 지형이 결과에 끼어들지 않게 걷어낸다 — 이 파일은 범위 공격(스플래시)만 본다. */
function noTerrain(state: MatchState): MatchState {
  return { ...state, terrain: {} };
}

/** 회피가 결과에 끼어들지 않게 전 기물의 실효 회피율을 0으로 고정한다. */
function noEvasion(state: MatchState): MatchState {
  return { ...state, pieces: state.pieces.map((p) => ({ ...p, baseEva: 0 })) };
}

describe('범위 공격 스킬 — nova (신규 시스템)', () => {
  it('nova는 splashRadius가 1인 범위 공격 스킬로 등록돼 있다', () => {
    const skill = requireSkill('nova');
    expect(skill.splashRadius).toBe(1);
    expect(skill.kind).toBe('damage');
  });

  it('주 대상 외에도 적중 지점 반경 내 다른 적에게 피해를 준다', () => {
    let state = noEvasion(
      noTerrain(startedMatch(deck('A', ['mystic', 'nova'], ['guard', 'cleave']), deck('B', ['lancer', 'bolt'], ['rider', 'cleave']))),
    );
    const casterId = state.pieces.find((p) => p.skillId === 'nova')!.id;
    const primaryId = state.pieces.find((p) => p.owner === 'B' && p.skillId === 'bolt')!.id;
    const splashId = state.pieces.find((p) => p.owner === 'B' && p.skillId === 'cleave')!.id;

    // 공격자 (3,3) -> 주 대상 (3,4): 거리 1, nova는 근접(사거리 1)이다. 스플래시 대상은 주 대상과 인접한 (3,5).
    state = place(state, { [casterId]: { x: 3, y: 3 }, [primaryId]: { x: 3, y: 4 }, [splashId]: { x: 3, y: 5 } });

    const before = { primary: getPiece(state, primaryId)!.hp, splash: getPiece(state, splashId)!.hp };
    const result = applyAction(state, { type: 'attack', player: 'A', pieceId: casterId, skillId: 'nova', targetId: primaryId });

    expect(getPiece(result.state, primaryId)!.hp).toBeLessThan(before.primary);
    expect(getPiece(result.state, splashId)!.hp).toBeLessThan(before.splash);
  });

  it('스플래시 반경 밖의 적은 영향받지 않는다', () => {
    let state = noEvasion(
      noTerrain(startedMatch(deck('A', ['mystic', 'nova'], ['guard', 'cleave']), deck('B', ['lancer', 'bolt'], ['rider', 'cleave']))),
    );
    const casterId = state.pieces.find((p) => p.skillId === 'nova')!.id;
    const primaryId = state.pieces.find((p) => p.owner === 'B' && p.skillId === 'bolt')!.id;
    const farId = state.pieces.find((p) => p.owner === 'B' && p.skillId === 'cleave')!.id;

    // 스플래시 대상 후보를 주 대상에서 반경 1칸을 넘는 (7,7)에 둔다 — 맞지 않아야 한다.
    state = place(state, { [casterId]: { x: 3, y: 3 }, [primaryId]: { x: 3, y: 4 }, [farId]: { x: 7, y: 7 } });

    const before = getPiece(state, farId)!.hp;
    const result = applyAction(state, { type: 'attack', player: 'A', pieceId: casterId, skillId: 'nova', targetId: primaryId });

    expect(getPiece(result.state, farId)!.hp).toBe(before);
  });

  it('splashRadius가 0인 일반 스킬은 주 대상 외에는 영향을 주지 않는다', () => {
    let state = noEvasion(
      noTerrain(startedMatch(deck('A', ['guard', 'cleave'], ['guard', 'cleave']), deck('B', ['lancer', 'bolt'], ['rider', 'cleave']))),
    );
    const casterId = state.pieces.filter((p) => p.owner === 'A')[0]!.id;
    const primaryId = state.pieces.find((p) => p.owner === 'B' && p.skillId === 'bolt')!.id;
    const bystanderId = state.pieces.find((p) => p.owner === 'B' && p.skillId === 'cleave')!.id;

    state = place(state, { [casterId]: { x: 3, y: 3 }, [primaryId]: { x: 3, y: 4 }, [bystanderId]: { x: 3, y: 5 } });

    const before = getPiece(state, bystanderId)!.hp;
    const result = applyAction(state, { type: 'attack', player: 'A', pieceId: casterId, skillId: 'cleave', targetId: primaryId });

    expect(getPiece(result.state, bystanderId)!.hp).toBe(before);
  });

  it('아군은 스플래시에 맞지 않는다', () => {
    let state = noEvasion(
      noTerrain(
        startedMatch(
          deck('A', ['mystic', 'nova'], ['guard', 'cleave'], ['acolyte', 'basic']),
          deck('B', ['lancer', 'bolt']),
        ),
      ),
    );
    const casterId = state.pieces.find((p) => p.skillId === 'nova')!.id;
    const primaryId = state.pieces.find((p) => p.owner === 'B')!.id;
    const allyId = state.pieces.find((p) => p.owner === 'A' && p.skillId === 'basic')!.id;

    // 아군을 스플래시 반경 안(주 대상과 인접)에 세워도 다치지 않아야 한다.
    state = place(state, { [casterId]: { x: 3, y: 3 }, [primaryId]: { x: 3, y: 4 }, [allyId]: { x: 3, y: 5 } });

    const before = getPiece(state, allyId)!.hp;
    const result = applyAction(state, { type: 'attack', player: 'A', pieceId: casterId, skillId: 'nova', targetId: primaryId });

    expect(getPiece(result.state, allyId)!.hp).toBe(before);
  });
});
