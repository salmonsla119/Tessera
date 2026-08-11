/**
 * 시드 난수.
 *
 * 커서를 상태에 담아 두기 때문에, 같은 (시드, 액션 로그)를 리플레이하면 항상 같은 결과가 나온다.
 * 커서 위치의 난수를 O(1)로 뽑을 수 있어야 리플레이가 길어져도 비용이 늘지 않으므로,
 * 순차 PRNG를 n번 돌리는 대신 (시드, 커서)를 해시하는 방식을 쓴다.
 */

function hash32(input: number): number {
  let x = (input + 0x9e3779b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return (x ^ (x >>> 15)) >>> 0;
}

/** (시드, 커서) → [0, 1) 균등분포. 순수 함수. */
export function randomAt(seed: number, cursor: number): number {
  const mixed = (seed ^ Math.imul(cursor + 1, 0x9e3779b1)) | 0;
  return hash32(mixed) / 4294967296;
}

/** 굴림 진행 상태. applyAction 안에서만 변이하고, 끝나면 커서를 새 상태에 기록한다. */
export interface Rng {
  seed: number;
  cursor: number;
}

export function createRng(seed: number, cursor = 0): Rng {
  return { seed, cursor };
}

export function next(rng: Rng): number {
  const value = randomAt(rng.seed, rng.cursor);
  rng.cursor += 1;
  return value;
}

/** [min, max] 정수 균등분포. */
export function rollInt(rng: Rng, min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(next(rng) * (max - min + 1));
}

/** 1 ~ sides 주사위. */
export function rollDie(rng: Rng, sides: number): number {
  return rollInt(rng, 1, sides);
}

/** 순차 PRNG. 시뮬레이터의 덱 생성처럼 리플레이 대상이 아닌 곳에서 쓴다. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
