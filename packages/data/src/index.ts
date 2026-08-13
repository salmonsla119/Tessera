import basesRaw from './bases.json';
import skillsRaw from './skills.json';
import { BaseSchema, SkillSchema, type Base, type Skill, type Deck, type DeckPiece } from './schema';
import { DECK_BUDGET, MAX_PIECES } from './constants';

export * from './schema';
export * from './constants';

/** 로드 시점에 데이터 테이블을 검증한다. 깨진 데이터를 들고 게임이 시작되지 않도록. */
export const BASES: readonly Base[] = BaseSchema.array().parse(basesRaw);
export const SKILLS: readonly Skill[] = SkillSchema.array().parse(skillsRaw);

const BASE_BY_ID = new Map(BASES.map((b) => [b.id, b]));
const SKILL_BY_ID = new Map(SKILLS.map((s) => [s.id, s]));

/** 모든 기물이 무료로 보유하는 기본 공격 (GDD §4). */
export const BASIC_SKILL_ID = 'basic';

export function getBase(id: string): Base | undefined {
  return BASE_BY_ID.get(id);
}

export function getSkill(id: string): Skill | undefined {
  return SKILL_BY_ID.get(id);
}

export function requireBase(id: string): Base {
  const base = BASE_BY_ID.get(id);
  if (!base) throw new Error(`알 수 없는 베이스 ID: ${id}`);
  return base;
}

export function requireSkill(id: string): Skill {
  const skill = SKILL_BY_ID.get(id);
  if (!skill) throw new Error(`알 수 없는 스킬 ID: ${id}`);
  return skill;
}

/** 덱빌딩에서 고를 수 있는 스킬 — 기본 공격은 무료 기본 보유이므로 선택 대상이 아니다. */
export const SELECTABLE_SKILLS: readonly Skill[] = SKILLS.filter((s) => !s.innate);

/** 계정 생성 시 가챠 없이 기본 지급되는 베이스/스킬 ID (신규 시스템 — 가챠). */
export const STARTER_BASE_IDS: readonly string[] = BASES.filter((b) => b.starter).map((b) => b.id);
export const STARTER_SKILL_IDS: readonly string[] = SKILLS.filter((s) => s.starter).map((s) => s.id);

/**
 * 스킬 사거리 유형 (신규 시스템). 셋 중 하나로만 나눈다:
 * - `melee`: 근접 — 사거리 1, 스플래시 없음(단일 대상).
 * - `ranged`: 원거리 — 사거리 2칸 이상, 스플래시 없음(단일 대상).
 * - `meleeArea`: 근접 범위기 — 사거리 1(붙어야 쓸 수 있다), 스플래시 있음(여러 대상).
 *
 * 값을 스킬 데이터에 별도로 저장하지 않고 range·splashRadius에서 그때그때 파생시킨다 —
 * 표기가 실제 수치와 어긋나는 일을 원천 차단하기 위해서다. 이 세 유형에 맞지 않는 조합
 * (예: 사거리가 먼 스플래시)은 애초에 skills.json 저작 시점에 만들지 않는다.
 */
export type SkillRangeCategory = 'melee' | 'ranged' | 'meleeArea';

export function skillRangeCategory(skill: Skill): SkillRangeCategory {
  if (skill.splashRadius > 0) return 'meleeArea';
  return skill.range <= 1 ? 'melee' : 'ranged';
}

/** 기물 코스트 = 베이스 코스트 + 스킬 코스트 (GDD §7.1) */
export function pieceCost(piece: DeckPiece): number {
  return requireBase(piece.baseId).cost + requireSkill(piece.skillId).cost;
}

export function deckCost(pieces: readonly DeckPiece[]): number {
  return pieces.reduce((sum, p) => sum + pieceCost(p), 0);
}

/** 매치 시작 시 확정되는 팀 속도 합 (GDD §2.2) */
export function deckSpeed(pieces: readonly DeckPiece[]): number {
  return pieces.reduce((sum, p) => sum + requireBase(p.baseId).spd, 0);
}

export interface DeckValidation {
  ok: boolean;
  cost: number;
  speed: number;
  errors: string[];
}

/**
 * 덱 유효성 검증 (GDD §7.1).
 * 클라이언트와 서버가 같은 함수를 쓴다 — 서버는 제출된 덱을 이 함수로 재검증한다.
 */
export function validateDeck(pieces: readonly DeckPiece[]): DeckValidation {
  const errors: string[] = [];

  for (const piece of pieces) {
    if (!BASE_BY_ID.has(piece.baseId)) errors.push(`알 수 없는 베이스 ID: ${piece.baseId}`);
    const skill = SKILL_BY_ID.get(piece.skillId);
    if (!skill) errors.push(`알 수 없는 스킬 ID: ${piece.skillId}`);
    else if (skill.innate) errors.push(`${skill.name}은(는) 기본 보유 스킬이라 편성할 수 없습니다`);
  }

  // ID 오류가 있으면 코스트를 계산할 수 없다.
  if (errors.length > 0) return { ok: false, cost: 0, speed: 0, errors };

  const cost = deckCost(pieces);
  const speed = deckSpeed(pieces);

  if (pieces.length === 0) errors.push('기물을 최소 1개 편성해야 합니다');
  if (pieces.length > MAX_PIECES) errors.push(`기물은 최대 ${MAX_PIECES}개입니다 (현재 ${pieces.length}개)`);
  if (cost > DECK_BUDGET) errors.push(`예산 초과: ${cost} / ${DECK_BUDGET}`);

  return { ok: errors.length === 0, cost, speed, errors };
}

export function validateDeckObject(deck: Deck): DeckValidation {
  return validateDeck(deck.pieces);
}
