import { z } from 'zod';

/** 이동 패턴. `ray`는 경로가 막히고, `jump`는 넘어간다 (GDD §5). */
export const MoveDirsSchema = z.enum(['orth', 'diag', 'all8', 'knight']);
export const MovePatternSchema = z.object({
  kind: z.enum(['ray', 'jump', 'area']),
  dirs: MoveDirsSchema,
  range: z.number().int().min(1),
});

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
});

/** 사거리 형태 (GDD §6). `area`만 경로를 무시한다. */
export const RangeShapeSchema = z.enum(['adjacent', 'orth', 'diag', 'all8', 'area']);

export const SkillEffectSchema = z.object({
  kind: z.enum(['evaDown', 'spDrain']),
  value: z.number().int(),
  turns: z.number().int().min(0),
});

export const SkillSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  minDamage: z.number().int().min(0),
  maxDamage: z.number().int().min(0),
  range: z.number().int().min(1),
  shape: RangeShapeSchema,
  spCost: z.number().int().min(0),
  cost: z.number().int().min(0),
  innate: z.boolean(),
  effect: SkillEffectSchema.nullable(),
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
export type Base = z.infer<typeof BaseSchema>;
export type RangeShape = z.infer<typeof RangeShapeSchema>;
export type SkillEffect = z.infer<typeof SkillEffectSchema>;
export type Skill = z.infer<typeof SkillSchema>;
export type DeckPiece = z.infer<typeof DeckPieceSchema>;
export type Deck = z.infer<typeof DeckSchema>;
