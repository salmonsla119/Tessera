import { BASIC_SKILL_ID, requireSkill, type RangeShape, type Skill } from '@tessera/data';
import { DIRS_ALL8, DIRS_DIAG, DIRS_ORTH, chebyshev, inBounds } from './board';
import { canAffordSp, pieceAt } from './state';
import type { Coord, MatchState, PieceState } from './types';

function raysFor(shape: Exclude<RangeShape, 'area' | 'adjacent'>): readonly Coord[] {
  switch (shape) {
    case 'orth':
      return DIRS_ORTH;
    case 'diag':
      return DIRS_DIAG;
    case 'all8':
      return DIRS_ALL8;
  }
}

/**
 * 스킬이 닿는 칸 (GDD §6).
 *
 * - `adjacent` — 8방향 1칸
 * - `orth` / `diag` / `all8` — 직선 레이. 첫 기물에서 멈추되 **그 칸은 포함한다**.
 *   `pierce`의 "직선상 첫 대상"이 이 규칙에서 그대로 나온다.
 * - `area` — 체비셰프 거리 내 전 칸, 경로 무시
 */
export function targetableCells(state: MatchState, from: Coord, skill: Skill): Coord[] {
  const cells: Coord[] = [];

  if (skill.shape === 'adjacent') {
    for (const dir of DIRS_ALL8) {
      const cell = { x: from.x + dir.x, y: from.y + dir.y };
      if (inBounds(cell)) cells.push(cell);
    }
    return cells;
  }

  if (skill.shape === 'area') {
    for (let dx = -skill.range; dx <= skill.range; dx++) {
      for (let dy = -skill.range; dy <= skill.range; dy++) {
        if (dx === 0 && dy === 0) continue;
        const cell = { x: from.x + dx, y: from.y + dy };
        if (!inBounds(cell)) continue;
        if (chebyshev(from, cell) > skill.range) continue;
        cells.push(cell);
      }
    }
    return cells;
  }

  for (const dir of raysFor(skill.shape)) {
    for (let step = 1; step <= skill.range; step++) {
      const cell = { x: from.x + dir.x * step, y: from.y + dir.y * step };
      if (!inBounds(cell)) break;
      cells.push(cell);
      // 기물을 만나면 그 칸까지가 사거리다. 뒤쪽은 가려진다.
      if (pieceAt(state, cell)) break;
    }
  }

  return cells;
}

/**
 * 해당 스킬로 지금 대상 지정할 수 있는 기물.
 * `damage` 스킬은 적만, `heal` 스킬은 아군(자신 포함)만 대상이 된다 (신규 시스템).
 */
export function validTargets(state: MatchState, piece: PieceState, skill: Skill): PieceState[] {
  if (!piece.alive || piece.pos === null) return [];
  const wantAlly = skill.kind === 'heal';
  const targets: PieceState[] = [];
  for (const cell of targetableCells(state, piece.pos, skill)) {
    const occupant = pieceAt(state, cell);
    if (!occupant) continue;
    const isAlly = occupant.owner === piece.owner;
    if (isAlly === wantAlly) targets.push(occupant);
  }
  // 힐은 자기 자신도 대상이 될 수 있는데, targetableCells는 자기 칸을 포함하지 않는다
  // (스킬 사거리는 "내 칸을 기준으로 다른 칸까지"로 정의돼 있으므로). 자힐은 별도로 넣어 준다.
  if (wantAlly && !targets.some((t) => t.id === piece.id)) targets.unshift(piece);
  return targets;
}

/**
 * 이 기물이 지금 쓸 수 있는 스킬 (GDD §4).
 * 기본 공격은 항상 가능하고, 편성 스킬은 잔여 SP가 코스트 이상일 때만 열린다.
 */
export function usableSkills(piece: PieceState): Skill[] {
  const basic = requireSkill(BASIC_SKILL_ID);
  const skills: Skill[] = [basic];
  if (piece.skillId !== BASIC_SKILL_ID) {
    const equipped = requireSkill(piece.skillId);
    if (canAffordSp(piece, equipped.spCost)) skills.push(equipped);
  }
  return skills;
}

/** 편성 스킬을 SP 부족으로 못 쓰는 상태인지 — UI에서 잠금 표시에 쓴다. */
export function isSkillLocked(piece: PieceState): boolean {
  if (piece.skillId === BASIC_SKILL_ID) return false;
  return !canAffordSp(piece, requireSkill(piece.skillId).spCost);
}
