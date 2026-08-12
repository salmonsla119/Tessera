import {
  requireBase,
  TERRAIN_BLOB_MAX_SIZE,
  TERRAIN_BLOB_MIN_SIZE,
  TERRAIN_SEED_Y_MAX,
  TERRAIN_SEED_Y_MIN,
  type TerrainKind,
} from '@tessera/data';
import { DIRS_ORTH, coordKey, inBounds, isDeployZone } from './board';
import { rollInt, type Rng } from './rng';
import type { Coord, MatchState, PieceState } from './types';

const CLUSTERED_TERRAIN: readonly TerrainKind[] = ['swamp', 'forest', 'glacier', 'scorched'];

/** 배치 구역은 항상 평지다 — 배치 직후 첫 턴에 손도 못 써보고 지형 피해를 입는 걸 막는다. */
function inAnyDeployZone(c: Coord): boolean {
  return isDeployZone('A', c) || isDeployZone('B', c);
}

/**
 * 지형 생성 (신규 시스템 — GDD 미기재, 구현 결정 사항).
 *
 * 씨앗 칸 하나에서 무작위로 번져 나가 지역처럼 뭉친 덩어리를 만든다 — 칸을 하나씩 흩뿌리면
 * 산발적으로 보이므로 이 방식을 쓴다. 매치의 시드 RNG를 그대로 이어 쓰므로 리플레이가
 * 결정론적이다 (createMatch가 첫 번째 굴림 이후 곧장 이 함수를 호출한다).
 */
export function generateTerrain(rng: Rng): Record<string, TerrainKind> {
  const terrain: Record<string, TerrainKind> = {};

  for (const kind of CLUSTERED_TERRAIN) {
    const seed: Coord = { x: rollInt(rng, 0, 7), y: rollInt(rng, TERRAIN_SEED_Y_MIN, TERRAIN_SEED_Y_MAX) };
    const blobSize = rollInt(rng, TERRAIN_BLOB_MIN_SIZE, TERRAIN_BLOB_MAX_SIZE);

    const claimed = new Set<string>([coordKey(seed)]);
    terrain[coordKey(seed)] = kind;
    const frontier: Coord[] = [seed];

    while (claimed.size < blobSize && frontier.length > 0) {
      const idx = rollInt(rng, 0, frontier.length - 1);
      const cell = frontier[idx]!;
      const options = DIRS_ORTH.map((d) => ({ x: cell.x + d.x, y: cell.y + d.y })).filter(
        (c) => inBounds(c) && !inAnyDeployZone(c) && !claimed.has(coordKey(c)),
      );
      if (options.length === 0) {
        frontier.splice(idx, 1);
        continue;
      }
      const next = options[rollInt(rng, 0, options.length - 1)]!;
      claimed.add(coordKey(next));
      terrain[coordKey(next)] = kind;
      frontier.push(next);
    }
  }

  return terrain;
}

export function terrainAt(state: MatchState, coord: Coord): TerrainKind {
  return state.terrain[coordKey(coord)] ?? 'plain';
}

/** 이 기물이 해당 지형의 페널티·효과를 전부 무시하는지 (terrainImmune 패시브). 평지는 애초에 영향이 없다. */
export function isImmuneToTerrain(piece: PieceState, terrain: TerrainKind): boolean {
  if (terrain === 'plain') return true;
  const passive = requireBase(piece.baseId).passive;
  return passive?.kind === 'terrainImmune' && passive.terrain === terrain;
}
