import { requireBase, type MoveDirs, type MovePattern } from '@tessera/data';
import { DIRS_ALL8, DIRS_DIAG, DIRS_ORTH, KNIGHT_OFFSETS, chebyshev, inBounds } from './board';
import { isOccupied } from './state';
import type { Coord, MatchState, PieceState } from './types';

export function dirsOf(dirs: MoveDirs): readonly Coord[] {
  switch (dirs) {
    case 'orth':
      return DIRS_ORTH;
    case 'diag':
      return DIRS_DIAG;
    case 'all8':
      return DIRS_ALL8;
    case 'knight':
      return KNIGHT_OFFSETS;
  }
}

/**
 * 이동 가능 칸 (GDD §5).
 *
 * 직선/대각(ray)은 경로 중간에 기물이 있으면 막히고, L자 도약(jump)은 넘어간다.
 */
export function movableCells(state: MatchState, piece: PieceState): Coord[] {
  if (!piece.alive || piece.pos === null) return [];
  const pattern: MovePattern = requireBase(piece.baseId).move;
  const from = piece.pos;
  const cells: Coord[] = [];

  switch (pattern.kind) {
    case 'ray': {
      for (const dir of dirsOf(pattern.dirs)) {
        for (let step = 1; step <= pattern.range; step++) {
          const cell = { x: from.x + dir.x * step, y: from.y + dir.y * step };
          if (!inBounds(cell)) break;
          // 아군이든 적군이든 기물이 있으면 그 칸에 설 수 없고 경로도 막힌다.
          if (isOccupied(state, cell)) break;
          cells.push(cell);
        }
      }
      break;
    }
    case 'jump': {
      for (const offset of dirsOf(pattern.dirs)) {
        const cell = { x: from.x + offset.x, y: from.y + offset.y };
        if (!inBounds(cell)) continue;
        if (isOccupied(state, cell)) continue;
        cells.push(cell);
      }
      break;
    }
    case 'area': {
      for (let dx = -pattern.range; dx <= pattern.range; dx++) {
        for (let dy = -pattern.range; dy <= pattern.range; dy++) {
          if (dx === 0 && dy === 0) continue;
          const cell = { x: from.x + dx, y: from.y + dy };
          if (!inBounds(cell)) continue;
          if (chebyshev(from, cell) > pattern.range) continue;
          if (isOccupied(state, cell)) continue;
          cells.push(cell);
        }
      }
      break;
    }
  }

  return cells;
}

export function canMoveTo(state: MatchState, piece: PieceState, to: Coord): boolean {
  return movableCells(state, piece).some((c) => c.x === to.x && c.y === to.y);
}
