import { z } from 'zod';

/** 이동 패턴. `ray`는 경로가 막히고, `jump`는 넘어간다 (GDD §5). */
export const MoveDirsSchema = z.enum(['orth', 'diag', 'all8', 'knight']);
export const MovePatternSchema = z.object({
  kind: z.enum(['ray', 'jump', 'area']),
  dirs: MoveDirsSchema,
  range: z.number().int().min(1),
});

/** 지형 (신규 시스템 — GDD 미기재, 구현 결정 사항). `plain`은 평지(효과 없음)다. */
export const TerrainKindSchema = z.enum(['plain', 'swamp', 'forest', 'glacier', 'scorched']);

/**
 * 상태이상 종류. `evaDown`·`burn`·`bleed`는 매 턴 값을 적용하고, `freeze`는 행동 자체를 막는다.
 * `evaUp`은 `evaDown`의 반대 방향(양수 보정)으로, 방어 스킬이 아군에게 거는 회피 버프다.
 */
export const StatusKindSchema = z.enum(['evaDown', 'burn', 'bleed', 'freeze', 'evaUp']);

/**
 * 베이스 패시브 (신규 시스템). 기물마다 최대 1개.
 * - `terrainImmune`: 지정 지형의 이동 페널티·효과를 전부 무시한다.
 * - `statusImmune`: 지정 상태이상에 걸리지 않는다.
 * - `auraHeal`: 자기 턴 시작마다 반경 내 아군(자신 포함)을 회복시킨다.
 * - `auraBuff`: 반경 내 아군(자신 포함)의 스탯에 상시 보정을 더한다.
 */
export const PassiveSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('terrainImmune'), terrain: TerrainKindSchema }),
  z.object({ kind: z.literal('statusImmune'), status: StatusKindSchema }),
  z.object({ kind: z.literal('auraHeal'), radius: z.number().int().min(1), amount: z.number().int().min(1) }),
  z.object({
    kind: z.literal('auraBuff'),
    radius: z.number().int().min(1),
    stat: z.enum(['atk', 'eva']),
    value: z.number().int(),
  }),
]);

export const BaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  moveLabel: z.string(),
  move: MovePatternSchema,
  hp: z.number().int().positive(),
  atk: z.number().int().min(0),
  sp: z.number().int().min(0),
  eva: z.number().int().min(0),
  spd: z.number().int().min(0),
  cost: z.number().int().min(0),
  passive: PassiveSchema.nullable(),
});

/** 사거리 형태 (GDD §6). `area`만 경로를 무시한다. */
export const RangeShapeSchema = z.enum(['adjacent', 'orth', 'diag', 'all8', 'area']);

/** `evaDown`·`burn`·`bleed`·`freeze`는 상태이상으로 남고, `spDrain`은 명중 즉시 1회 적용된다. */
export const SkillEffectSchema = z.object({
  kind: z.enum(['evaDown', 'spDrain', 'burn', 'bleed', 'freeze']),
  value: z.number().int(),
  turns: z.number().int().min(0),
});

/** `damage`는 적을, `heal`·`defense`는 아군(자신 포함)을 대상으로 한다. */
export const SkillKindSchema = z.enum(['damage', 'heal', 'defense']);

export const SkillSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: SkillKindSchema,
  minDamage: z.number().int().min(0),
  maxDamage: z.number().int().min(0),
  range: z.number().int().min(1),
  shape: RangeShapeSchema,
  spCost: z.number().int().min(0),
  cost: z.number().int().min(0),
  innate: z.boolean(),
  effect: SkillEffectSchema.nullable(),
  /** 0이면 단일 대상. 그 이상이면 적중 지점 기준 이 반경(체비셰프) 내 다른 적에게도 데미지·부가효과를 준다 (범위 공격, 신규 시스템). */
  splashRadius: z.number().int().min(0),
  /** `defense` 스킬 전용 — minDamage~maxDamage로 굴린 회피 버프(evaUp)가 지속되는 턴 수. 그 외 스킬은 0. */
  buffTurns: z.number().int().min(0),
  note: z.string(),
});

/** 기물 1개 = 베이스 1개 + 스킬 1개 (GDD §7.1). */
export const DeckPieceSchema = z.object({
  baseId: z.string().min(1),
  skillId: z.string().min(1),
});

export const DeckSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  pieces: z.array(DeckPieceSchema),
});

export type MoveDirs = z.infer<typeof MoveDirsSchema>;
export type MovePattern = z.infer<typeof MovePatternSchema>;
export type TerrainKind = z.infer<typeof TerrainKindSchema>;
export type StatusKind = z.infer<typeof StatusKindSchema>;
export type Passive = z.infer<typeof PassiveSchema>;
export type Base = z.infer<typeof BaseSchema>;
export type RangeShape = z.infer<typeof RangeShapeSchema>;
export type SkillEffect = z.infer<typeof SkillEffectSchema>;
export type SkillKind = z.infer<typeof SkillKindSchema>;
export type Skill = z.infer<typeof SkillSchema>;
export type DeckPiece = z.infer<typeof DeckPieceSchema>;
export type Deck = z.infer<typeof DeckSchema>;
