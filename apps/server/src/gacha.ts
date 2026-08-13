import { gachaPoolByRarity, GACHA_RARITY_WEIGHTS, type GachaItemType, type Rarity } from '@tessera/data';

function randomUint32(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}

/** [0, 100) 균등 분포 실수. */
function randomPercent(): number {
  return (randomUint32() / 0x1_0000_0000) * 100;
}

function rollRarity(): Rarity {
  const roll = randomPercent();
  let acc = 0;
  for (const [rarity, weight] of Object.entries(GACHA_RARITY_WEIGHTS) as [Rarity, number][]) {
    acc += weight;
    if (roll < acc) return rarity;
  }
  return 'legendary'; // 부동소수 누적 오차로 못 걸리는 극히 드문 경우의 안전망
}

function rollItemType(): GachaItemType {
  return randomUint32() % 2 === 0 ? 'base' : 'skill';
}

export interface GachaResult {
  itemType: GachaItemType;
  itemId: string;
  rarity: Rarity;
}

/**
 * 타입(베이스/스킬) → 등급 순으로 굴린 뒤 해당 풀에서 무작위로 하나를 고른다.
 * 그 조합의 풀이 비어 있으면(예: 아직 그 등급 항목이 없음) 다시 굴린다.
 */
export function rollGachaItem(): GachaResult {
  for (let attempt = 0; attempt < 20; attempt++) {
    const itemType = rollItemType();
    const rarity = rollRarity();
    const pool = gachaPoolByRarity(itemType)[rarity];
    if (pool.length === 0) continue;
    const itemId = pool[randomUint32() % pool.length]!;
    return { itemType, itemId, rarity };
  }
  throw new Error('가챠 풀이 비어 있습니다');
}
