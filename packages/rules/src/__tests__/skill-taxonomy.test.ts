import { SKILLS, skillRangeCategory } from '@tessera/data';
import { describe, expect, it } from 'vitest';

describe('스킬 사거리 유형 (신규 시스템)', () => {
  it('모든 스킬은 근접·원거리·근접범위기 셋 중 하나로만 분류된다', () => {
    for (const skill of SKILLS) {
      const category = skillRangeCategory(skill);
      expect(['melee', 'ranged', 'meleeArea']).toContain(category);
    }
  });

  it('사거리가 먼(2칸 이상) 스플래시 스킬은 없다 — 범위기는 항상 근접이어야 한다', () => {
    for (const skill of SKILLS) {
      if (skill.splashRadius > 0) {
        expect(skill.range).toBe(1);
      }
    }
  });

  it('근접 스킬(사거리 1, 스플래시 없음)로 분류된다', () => {
    expect(skillRangeCategory({ range: 1, splashRadius: 0 } as never)).toBe('melee');
  });

  it('원거리 스킬(사거리 2 이상, 스플래시 없음)로 분류된다', () => {
    expect(skillRangeCategory({ range: 3, splashRadius: 0 } as never)).toBe('ranged');
  });

  it('근접범위기(사거리 1, 스플래시 있음)로 분류된다', () => {
    expect(skillRangeCategory({ range: 1, splashRadius: 1 } as never)).toBe('meleeArea');
  });
});
