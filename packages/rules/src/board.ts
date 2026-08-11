import { BOARD_SIZE, DEPLOY_ROWS } from '@tessera/data';
import type { Coord, PlayerId } from './types';

export const DIRS_ORTH: readonly Coord[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

export const DIRS_DIAG: readonly Coord[] = [
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

export const DIRS_ALL8: readonly Coord[] = [...DIRS_ORTH, ...DIRS_DIAG];

export const KNIGHT_OFFSETS: readonly Coord[] = [
  { x: 1, y: 2 },
  { x: 2, y: 1 },
  { x: 2, y: -1 },
  { x: 1, y: -2 },
  { x: -1, y: -2 },
  { x: -2, y: -1 },
  { x: -2, y: 1 },
  { x: -1, y: 2 },
];

export function inBounds(c: Coord): boolean {
  return c.x >= 0 && c.x < BOARD_SIZE && c.y >= 0 && c.y < BOARD_SIZE;
}

/** 체비셰프 거리 — 8방향 격자의 거리 (GDD §3.2). */
export function chebyshev(a: Coord, b: Coord): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function sameCoord(a: Coord, b: Coord): boolean {
  return a.x === b.x && a.y === b.y;
}

export function coordKey(c: Coord): string {
  return `${c.x},${c.y}`;
}

/** A는 rank 1~2, B는 rank 7~8이 배치 구역 (GDD §8.2). */
export function isDeployZone(player: PlayerId, c: Coord): boolean {
  if (!inBounds(c)) return false;
  return player === 'A' ? c.y < DEPLOY_ROWS : c.y >= BOARD_SIZE - DEPLOY_ROWS;
}

export function deployZoneCells(player: PlayerId): Coord[] {
  const cells: Coord[] = [];
  const yStart = player === 'A' ? 0 : BOARD_SIZE - DEPLOY_ROWS;
  for (let y = yStart; y < yStart + DEPLOY_ROWS; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) cells.push({ x, y });
  }
  return cells;
}

export function opponentOf(player: PlayerId): PlayerId {
  return player === 'A' ? 'B' : 'A';
}
