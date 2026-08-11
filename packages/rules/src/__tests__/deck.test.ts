import { DECK_BUDGET, MAX_PIECES, deckCost, deckSpeed, validateDeck } from '@tessera/data';
import { describe, expect, it } from 'vitest';
import { runSimulation } from '../sim';

const piece = (baseId: string, skillId: string) => ({ baseId, skillId });

describe('덱 검증 (GDD §7.1)', () => {
  it('30코스트 6기물 덱을 통과시킨다', () => {
    // guard+cleave(5) ×6 = 30
    const pieces = Array.from({ length: 6 }, () => piece('guard', 'cleave'));
    const result = validateDeck(pieces);
    expect(result.ok).toBe(true);
    expect(result.cost).toBe(DECK_BUDGET);
    expect(result.speed).toBe(36);
  });

  it('예산을 넘는 덱을 거부한다', () => {
    // warlord+smite = 11, ×3 = 33 > 30
    const pieces = Array.from({ length: 3 }, () => piece('warlord', 'smite'));
    const result = validateDeck(pieces);
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain('예산 초과');
  });

  it('7기물 덱을 거부한다', () => {
    // 코스트만 보면 통과하지만 기물 수에서 걸려야 한다.
    const pieces = Array.from({ length: 7 }, () => piece('guard', 'cleave'));
    const result = validateDeck(pieces);
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain(`최대 ${MAX_PIECES}개`);
  });

  it('미등록 스킬 ID를 거부한다', () => {
    const result = validateDeck([piece('guard', 'fireball')]);
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain('알 수 없는 스킬 ID');
  });

  it('미등록 베이스 ID를 거부한다', () => {
    const result = validateDeck([piece('dragon', 'cleave')]);
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain('알 수 없는 베이스 ID');
  });

  it('기본 공격은 편성 대상이 아니다', () => {
    const result = validateDeck([piece('guard', 'basic')]);
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain('기본 보유');
  });

  it('빈 덱을 거부한다', () => {
    expect(validateDeck([]).ok).toBe(false);
  });

  it('코스트와 속도 합을 정확히 계산한다', () => {
    const pieces = [piece('warlord', 'smite'), piece('ranger', 'pierce')];
    expect(deckCost(pieces)).toBe(6 + 5 + 4 + 3);
    expect(deckSpeed(pieces)).toBe(14 + 11);
  });
});

describe('헤드리스 자동 대전 (PLAN §8.2)', () => {
  it('진행이 멈추는 매치 없이 전부 종료된다', () => {
    const summary = runSimulation(120, 1);
    expect(summary.timeoutRate).toBe(0);
    expect(summary.avgRounds).toBeGreaterThan(0);
  }, 60_000);
});
