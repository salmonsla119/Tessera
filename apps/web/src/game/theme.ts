import {
  getBase,
  getSkill,
  type Passive,
  type SkillKind,
  type SkillRangeCategory,
  type StatusKind,
  type TerrainKind,
} from '@tessera/data';
import type { PlayerId } from '@tessera/rules';

export const CELL = 66;
export const PAD = 24;
export const BOARD_PX = CELL * 8 + PAD * 2;

export const COLORS = {
  boardLight: 0x232937,
  boardDark: 0x1b202b,
  boardEdge: 0x2b3242,
  label: 0x6f7a90,
  moveHint: 0x4ade80,
  attackHint: 0xf87171,
  healHint: 0x4ade80,
  defenseHint: 0x6ea8fe,
  selected: 0x6ea8fe,
  deployZone: 0x6ea8fe,
  playerA: 0x4c8dff,
  playerB: 0xff6b6b,
  hpBar: 0x4ade80,
  hpBarBg: 0x0c0f16,
  spBar: 0x6ea8fe,
  hidden: 0x515a6e,
} as const;

/** 지형 타일 색 (신규 시스템). 평지는 칠하지 않는다 — 기본 체스판 무늬 그대로 둔다. */
export const TERRAIN_COLORS: Partial<Record<TerrainKind, number>> = {
  swamp: 0x4d5a2e,
  forest: 0x1f4d33,
  glacier: 0x3a5f7a,
  scorched: 0x6b2f22,
};

export const TERRAIN_LABEL: Record<TerrainKind, string> = {
  plain: '평지',
  swamp: '늪지',
  forest: '숲',
  glacier: '빙판',
  scorched: '화염지대',
};

export const TERRAIN_NOTE: Record<TerrainKind, string> = {
  plain: '',
  swamp: '이동 범위 −1 · 매 턴 시작 시 피해',
  forest: '이동 범위 −1 · 회피율 +15%',
  glacier: '이동 범위 −1 · 매 턴 시작 시 50% 확률로 빙결',
  scorched: '이동 범위 −1 · 매 턴 시작 시 화상 부여',
};

export const STATUS_LABEL: Record<StatusKind, string> = {
  evaDown: '회피 감소',
  burn: '화상',
  bleed: '출혈',
  freeze: '빙결',
  evaUp: '회피 증가',
};

export const STATUS_COLOR: Record<StatusKind, string> = {
  evaDown: '#c084fc',
  burn: '#ff8f4d',
  bleed: '#ff5d6c',
  freeze: '#7dd3fc',
  evaUp: '#6ea8fe',
};

/** 스킬 사거리 유형 표기 (신규 시스템). */
export const SKILL_RANGE_LABEL: Record<SkillRangeCategory, string> = {
  melee: '근접',
  ranged: '원거리',
  meleeArea: '근접범위',
};

export const SKILL_RANGE_COLOR: Record<SkillRangeCategory, string> = {
  melee: '#f87171',
  ranged: '#6ea8fe',
  meleeArea: '#fbbf24',
};

/** 스킬 종류(공격/회복/방어) 표기 (신규 시스템). */
export const SKILL_KIND_LABEL: Record<SkillKind, string> = {
  damage: '공격',
  heal: '회복',
  defense: '방어',
};

export const SKILL_KIND_COLOR: Record<SkillKind, string> = {
  damage: '#f87171',
  heal: '#4ade80',
  defense: '#6ea8fe',
};

/** 패시브를 사람이 읽는 한 줄 설명으로 바꾼다 (신규 시스템). */
export function describePassive(passive: Passive): string {
  switch (passive.kind) {
    case 'terrainImmune':
      return `${TERRAIN_LABEL[passive.terrain]} 지형 면역 (페널티·효과 모두 무시)`;
    case 'statusImmune':
      return `${STATUS_LABEL[passive.status]} 면역`;
    case 'auraHeal':
      return `자기 턴 시작 시 반경 ${passive.radius}칸 이내 아군(자신 포함) HP +${passive.amount}`;
    case 'auraBuff':
      return `반경 ${passive.radius}칸 이내 아군(자신 포함) ${passive.stat === 'atk' ? '공격력' : '회피'} +${passive.value}`;
  }
}

export function ownerColor(owner: PlayerId): number {
  return owner === 'A' ? COLORS.playerA : COLORS.playerB;
}

const SHORT_LABEL: Record<string, string> = {
  guard: '방',
  lancer: '창',
  rider: '기',
  acolyte: '사',
  ranger: '순',
  warlord: '장',
  mystic: '주',
  berserker: '광',
  paladin: '성',
  assassin: '자',
  shaman: '토',
  templar: '단',
  frostguard: '서',
  swampstalker: '늪',
  pyromancer: '화',
};

export function pieceLabel(baseId: string): string {
  return SHORT_LABEL[baseId] ?? '?';
}

export function baseName(baseId: string): string {
  return getBase(baseId)?.name ?? '???';
}

export function skillName(skillId: string): string {
  return getSkill(skillId)?.name ?? '???';
}

/** 보드 좌표 → 캔버스 픽셀. y는 위아래를 뒤집는다 (rank 1이 아래). */
export function toPixel(x: number, y: number): { px: number; py: number } {
  return { px: PAD + x * CELL + CELL / 2, py: PAD + (7 - y) * CELL + CELL / 2 };
}

/** 캔버스 픽셀 → 보드 좌표. 보드 밖이면 null. */
export function toCell(px: number, py: number): { x: number; y: number } | null {
  const x = Math.floor((px - PAD) / CELL);
  const y = 7 - Math.floor((py - PAD) / CELL);
  if (x < 0 || x > 7 || y < 0 || y > 7) return null;
  return { x, y };
}
