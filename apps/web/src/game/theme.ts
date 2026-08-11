import { getBase, getSkill } from '@tessera/data';
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
  selected: 0x6ea8fe,
  deployZone: 0x6ea8fe,
  playerA: 0x4c8dff,
  playerB: 0xff6b6b,
  hpBar: 0x4ade80,
  hpBarBg: 0x0c0f16,
  spBar: 0x6ea8fe,
  hidden: 0x515a6e,
} as const;

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
