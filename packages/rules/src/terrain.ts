import {
  requireBase,
  TERRAIN_BLOB_MAX_SIZE,
  TERRAIN_BLOB_MIN_SIZE,
  TERRAIN_MAX_KINDS_PER_MATCH,
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
 * 이번 매치에 등장할 지형 종류를 4종 중 TERRAIN_MAX_KINDS_PER_MATCH개만 무작위로 고른다
 * (신규 시스템 — GDD "최대 3개" 지시를 그대로 캡으로 옮겼다. 4종 중 하나를 무작위로 뺀다).
 */
function pickTerrainKinds(rng: Rng): TerrainKind[] {
  const dropCount = CLUSTERED_TERRAIN.length - TERRAIN_MAX_KINDS_PER_MATCH;
  const remaining = [...CLUSTERED_TERRAIN];
  for (let i = 0; i < dropCount; i++) {
    remaining.splice(rollInt(rng, 0, remaining.length - 1), 1);
  }
  return remaining;
}

/** 다른 지형 덩어리와 겹치지 않는 씨앗 칸을 찾는다. 자리가 없으면 null (그 종류는 이번 매치에 등장하지 않는다). */
function pickSeed(rng: Rng, globalClaimed: ReadonlySet<string>): Coord | null {
  for (let attempt = 0; attempt < 30; attempt++) {
    const seed: Coord = { x: rollInt(rng, 0, 7), y: rollInt(rng, TERRAIN_SEED_Y_MIN, TERRAIN_SEED_Y_MAX) };
    if (!globalClaimed.has(coordKey(seed))) return seed;
  }
  return null;
}

/**
 * 지형 생성 (신규 시스템 — GDD 미기재, 구현 결정 사항).
 *
 * 씨앗 칸 하나에서 무작위로 번져 나가 지역처럼 뭉친 덩어리를 만든다 — 칸을 하나씩 흩뿌리면
 * 산발적으로 보이므로 이 방식을 쓴다. 매치의 시드 RNG를 그대로 이어 쓰므로 리플레이가
 * 결정론적이다 (createMatch가 첫 번째 굴림 이후 곧장 이 함수를 호출한다).
 *
 * 덩어리 크기는 13~30칸을 목표로 하지만, 배치 구역을 뺀 보드 여유 칸(8×8에서 양측 2열씩 뺀
 * 32칸)이 그보다 적으면 채울 수 있는 만큼만 채우고 멈춘다 — 서로 다른 종류끼리는 절대 겹치지
 * 않으므로(globalClaimed), 지형 3종을 동시에 최댓값(30칸)까지 채우는 건 애초에 산수상 불가능하다
 * (30×3 > 32). 뒤에 고른 종류일수록 남은 자리가 적어 작게, 또는 아예 등장하지 않을 수 있다.
 */
export function generateTerrain(rng: Rng): Record<string, TerrainKind> {
  const terrain: Record<string, TerrainKind> = {};
  const globalClaimed = new Set<string>();
  const kinds = pickTerrainKinds(rng);

  for (const kind of kinds) {
    const seed = pickSeed(rng, globalClaimed);
    if (!seed) continue;

    const blobSize = rollInt(rng, TERRAIN_BLOB_MIN_SIZE, TERRAIN_BLOB_MAX_SIZE);
    const claimed = new Set<string>([coordKey(seed)]);
    globalClaimed.add(coordKey(seed));
    terrain[coordKey(seed)] = kind;
    const frontier: Coord[] = [seed];

    while (claimed.size < blobSize && frontier.length > 0) {
      const idx = rollInt(rng, 0, frontier.length - 1);
      const cell = frontier[idx]!;
      const options = DIRS_ORTH.map((d) => ({ x: cell.x + d.x, y: cell.y + d.y })).filter(
        (c) => inBounds(c) && !inAnyDeployZone(c) && !globalClaimed.has(coordKey(c)),
      );
      if (options.length === 0) {
        frontier.splice(idx, 1);
        continue;
      }
      const next = options[rollInt(rng, 0, options.length - 1)]!;
      claimed.add(coordKey(next));
      globalClaimed.add(coordKey(next));
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
