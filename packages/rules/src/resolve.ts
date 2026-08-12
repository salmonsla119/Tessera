import {
  AP_COST_ATTACK,
  AP_COST_FOCUS,
  AP_COST_MOVE,
  GLACIER_FREEZE_CHANCE,
  GLACIER_FREEZE_TURNS,
  SCORCHED_BURN_TURNS,
  SCORCHED_BURN_VALUE,
  SP_GAIN_ON_FOCUS,
  SP_REGEN_PER_TURN,
  SUDDEN_DEATH_DAMAGE,
  SUDDEN_DEATH_ROUND,
  SWAMP_DAMAGE,
  requireSkill,
  type SkillEffect,
  type TerrainKind,
} from '@tessera/data';
import { accrueAp } from './ap';
import { checkAction } from './actions';
import { chebyshev, opponentOf } from './board';
import { resolveDamage, resolveHeal } from './damage';
import { auraHealTargets, isImmuneToStatus } from './passives';
import { createRng, rollDie, type Rng } from './rng';
import { cloneState, getPiece, livingPieces } from './state';
import { isImmuneToTerrain, terrainAt } from './terrain';
import type { Action, ApplyResult, GameEvent, MatchState, PieceState, PlayerId } from './types';

export class IllegalActionError extends Error {
  constructor(
    message: string,
    readonly action: Action,
  ) {
    super(message);
    this.name = 'IllegalActionError';
  }
}

/**
 * 액션 적용 (PLAN §3.1).
 *
 * 순수 함수 — 입력 상태를 변형하지 않고 새 상태와 연출용 이벤트 배열을 돌려준다.
 * Phaser는 이 이벤트만 보고 연출하며, 상태를 직접 읽어 계산하지 않는다 (PLAN §3.2).
 */
export function applyAction(state: MatchState, action: Action): ApplyResult {
  const legality = checkAction(state, action);
  if (!legality.ok) {
    throw new IllegalActionError(legality.reason ?? '허용되지 않는 액션입니다', action);
  }

  const next = cloneState(state);
  const rng = createRng(next.seed, next.rngCursor);
  const events: GameEvent[] = [];

  switch (action.type) {
    case 'deploy': {
      for (const placement of action.placements) {
        const piece = mustGet(next, placement.pieceId);
        piece.pos = { ...placement.pos };
      }
      next.deployedPlayers.push(action.player);
      events.push({ type: 'Deployed', player: action.player });

      // 양측 제출이 끝나야 덱과 배치가 동시에 공개된다 (GDD §8.1).
      if (next.deployedPlayers.length === 2) {
        next.phase = 'battle';
        events.push({ type: 'BattleStarted' });
        startTurn(next, next.first, rng, events);
      }
      break;
    }

    case 'move': {
      const piece = mustGet(next, action.pieceId);
      const from = { ...piece.pos! };
      piece.pos = { ...action.to };
      next.ap[action.player] -= AP_COST_MOVE;
      events.push({ type: 'PieceMoved', pieceId: piece.id, from, to: { ...action.to } });
      autoEndTurn(next, action.player, rng, events);
      break;
    }

    case 'focus': {
      const piece = mustGet(next, action.pieceId);
      piece.sp = Math.min(piece.maxSp, piece.sp + SP_GAIN_ON_FOCUS);
      next.ap[action.player] -= AP_COST_FOCUS;
      events.push({ type: 'Focused', pieceId: piece.id, sp: piece.sp });
      autoEndTurn(next, action.player, rng, events);
      break;
    }

    case 'attack': {
      resolveSkillUse(next, action.pieceId, action.skillId, action.targetId, rng, events);
      next.ap[action.player] -= AP_COST_ATTACK;
      if (next.phase !== 'finished') autoEndTurn(next, action.player, rng, events);
      break;
    }

    case 'endTurn': {
      endTurn(next, action.player, rng, events);
      break;
    }
  }

  next.rngCursor = rng.cursor;
  return { state: next, events };
}

function mustGet(state: MatchState, id: string): PieceState {
  const piece = getPiece(state, id);
  if (!piece) throw new Error(`알 수 없는 기물: ${id}`);
  return piece;
}

/** 'attack' 액션 하나가 damage 스킬이면 공격을, heal 스킬이면 치유를 수행한다 (신규 시스템). */
function resolveSkillUse(
  state: MatchState,
  casterId: string,
  skillId: string,
  targetId: string,
  rng: Rng,
  events: GameEvent[],
): void {
  const skill = requireSkill(skillId);
  if (skill.kind === 'heal') {
    resolveHealUse(state, casterId, skill.id, targetId, rng, events);
  } else {
    resolveAttack(state, casterId, skill.id, targetId, rng, events);
  }
}

function resolveHealUse(
  state: MatchState,
  casterId: string,
  skillId: string,
  targetId: string,
  rng: Rng,
  events: GameEvent[],
): void {
  const caster = mustGet(state, casterId);
  const target = mustGet(state, targetId);
  const skill = requireSkill(skillId);
  const from = { ...caster.pos! };
  const to = { ...target.pos! };

  caster.sp -= skill.spCost;

  const amount = resolveHeal(rng, skill);
  events.push({
    type: 'SkillUsed',
    pieceId: caster.id,
    skillId: skill.id,
    targetId: target.id,
    from,
    to,
    distance: chebyshev(from, to),
    preview: { min: skill.minDamage, max: skill.maxDamage },
  });

  const before = target.hp;
  target.hp = Math.min(target.maxHp, target.hp + amount);
  events.push({ type: 'Healed', pieceId: target.id, amount: target.hp - before, hp: target.hp });
}

function resolveAttack(
  state: MatchState,
  attackerId: string,
  skillId: string,
  targetId: string,
  rng: Rng,
  events: GameEvent[],
): void {
  const attacker = mustGet(state, attackerId);
  const target = mustGet(state, targetId);
  const skill = requireSkill(skillId);
  const from = { ...attacker.pos! };
  const to = { ...target.pos! };
  const distance = chebyshev(from, to);

  attacker.sp -= skill.spCost;

  const result = resolveDamage(rng, state, attacker, target, skill, distance);

  events.push({
    type: 'SkillUsed',
    pieceId: attacker.id,
    skillId: skill.id,
    targetId: target.id,
    from,
    to,
    distance,
    preview: result.preview,
  });
  events.push({ type: 'DiceRolled', kind: 'damage', value: result.rolled, sides: 0 });
  events.push({ type: 'DiceRolled', kind: 'evade', value: result.evadeRoll, sides: 100 });

  if (result.evaded) {
    events.push({ type: 'Evaded', pieceId: target.id });
    return;
  }

  target.hp = Math.max(0, target.hp - result.dealt);
  events.push({ type: 'Damaged', pieceId: target.id, amount: result.dealt, hp: target.hp });

  // 부가 효과는 명중했을 때만 적용된다 — 완전 회피는 공격 자체가 빗나간 것으로 본다.
  if (skill.effect && target.alive) {
    applyStatusOrDrain(target, skill.effect, events);
  }

  if (target.hp <= 0) killPiece(target, events);
  checkVictory(state, events);
}

/** 스킬 부가효과 하나를 대상에게 적용한다. statusImmune 패시브는 상태이상만 막고 spDrain은 막지 않는다. */
function applyStatusOrDrain(target: PieceState, effect: SkillEffect, events: GameEvent[]): void {
  if (effect.kind === 'spDrain') {
    const before = target.sp;
    target.sp = Math.max(0, target.sp - effect.value);
    events.push({ type: 'SpDrained', pieceId: target.id, amount: before - target.sp, sp: target.sp });
    return;
  }

  if (isImmuneToStatus(target, effect.kind)) return;
  target.statuses.push({ kind: effect.kind, value: effect.value, turnsLeft: effect.turns });
  events.push({ type: 'StatusApplied', pieceId: target.id, kind: effect.kind, value: effect.value, turns: effect.turns });
}

function killPiece(piece: PieceState, events: GameEvent[]): void {
  piece.alive = false;
  piece.pos = null;
  piece.hp = 0;
  events.push({ type: 'PieceDown', pieceId: piece.id });
}

/**
 * 승리 조건은 상대 기물 전멸 하나뿐이다 (GDD §8.3).
 * 매치가 끝났는지를 반환한다 — 호출부가 이후 처리를 건너뛸 수 있도록.
 */
function checkVictory(state: MatchState, events: GameEvent[]): boolean {
  if (state.phase === 'finished') return true;
  const aliveA = livingPieces(state, 'A').length;
  const aliveB = livingPieces(state, 'B').length;
  if (aliveA > 0 && aliveB > 0) return false;

  state.phase = 'finished';
  state.winner = aliveA === 0 && aliveB === 0 ? 'draw' : aliveA > 0 ? 'A' : 'B';
  events.push({ type: 'MatchEnded', winner: state.winner });
  return true;
}

/** AP를 다 쓰면 턴이 자동으로 넘어간다 (GDD §8.1). */
function autoEndTurn(state: MatchState, player: PlayerId, rng: Rng, events: GameEvent[]): void {
  if (state.ap[player] > 0) return;
  endTurn(state, player, rng, events);
}

function endTurn(state: MatchState, player: PlayerId, rng: Rng, events: GameEvent[]): void {
  events.push({ type: 'TurnEnded', player });
  state.ap[player] = 0;
  startTurn(state, opponentOf(player), rng, events);
}

function startTurn(state: MatchState, player: PlayerId, rng: Rng, events: GameEvent[]): void {
  if (state.phase === 'finished') return;

  state.turnOwner = player;
  state.turn += 1;
  state.round = Math.ceil(state.turn / 2);

  // 서든데스 — 40라운드 경과 후 매 턴 시작 시 양측 전 기물 HP −2 (GDD §8.4).
  if (state.round > SUDDEN_DEATH_ROUND) {
    state.suddenDeath = true;
    events.push({ type: 'SuddenDeath', round: state.round, damage: SUDDEN_DEATH_DAMAGE });
    for (const piece of state.pieces) {
      if (!piece.alive) continue;
      piece.hp = Math.max(0, piece.hp - SUDDEN_DEATH_DAMAGE);
      events.push({ type: 'Damaged', pieceId: piece.id, amount: SUDDEN_DEATH_DAMAGE, hp: piece.hp });
      if (piece.hp <= 0) killPiece(piece, events);
    }
    if (checkVictory(state, events)) return;
  }

  for (const piece of state.pieces) {
    if (!piece.alive || piece.owner !== player) continue;

    if (piece.sp < piece.maxSp) {
      piece.sp = Math.min(piece.maxSp, piece.sp + SP_REGEN_PER_TURN);
      events.push({ type: 'SpRegen', pieceId: piece.id, sp: piece.sp });
    }

    // 화상·출혈은 대상 턴 시작마다 피해를 준 뒤 다른 상태이상과 함께 지속시간이 줄어든다
    // (GDD §9 미확정 항목을 이 규칙으로 확정 — 대상 턴 기준).
    for (const status of piece.statuses) {
      if (!piece.alive) break;
      if (status.kind === 'burn' || status.kind === 'bleed') {
        piece.hp = Math.max(0, piece.hp - status.value);
        events.push({ type: 'Damaged', pieceId: piece.id, amount: status.value, hp: piece.hp });
        if (piece.hp <= 0) killPiece(piece, events);
      }
    }

    if (piece.statuses.length > 0) {
      piece.statuses = piece.statuses
        .map((s) => ({ ...s, turnsLeft: s.turnsLeft - 1 }))
        .filter((s) => s.turnsLeft > 0);
    }

    if (piece.alive && piece.pos) {
      applyTerrainTurnEffect(piece, terrainAt(state, piece.pos), rng, events);
    }
  }

  if (checkVictory(state, events)) return;

  // 아군 치유 오라 — 자기 턴 시작마다, 위 피해 처리가 끝난 뒤에 적용한다 (신규 시스템).
  for (const healer of state.pieces) {
    if (!healer.alive || healer.owner !== player || !healer.pos) continue;
    for (const heal of auraHealTargets(state, healer)) {
      const target = getPiece(state, heal.targetId)!;
      const before = target.hp;
      target.hp = Math.min(target.maxHp, target.hp + heal.amount);
      if (target.hp !== before) {
        events.push({ type: 'Healed', pieceId: target.id, amount: target.hp - before, hp: target.hp });
      }
    }
  }

  const { ap, carryTenths } = accrueAp(state.apPoolTenths[player], state.teamSpeed[player]);
  state.ap[player] = ap;
  state.apPoolTenths[player] = carryTenths;

  events.push({
    type: 'TurnStarted',
    player,
    turn: state.turn,
    round: state.round,
    ap,
    carryTenths,
  });
}

/** 지형이 매 턴 시작 시 주는 효과 (신규 시스템). 면역 패시브가 있으면 아무 일도 없다. */
function applyTerrainTurnEffect(piece: PieceState, terrain: TerrainKind, rng: Rng, events: GameEvent[]): void {
  if (terrain === 'plain' || isImmuneToTerrain(piece, terrain)) return;

  switch (terrain) {
    case 'swamp':
      piece.hp = Math.max(0, piece.hp - SWAMP_DAMAGE);
      events.push({ type: 'Damaged', pieceId: piece.id, amount: SWAMP_DAMAGE, hp: piece.hp });
      if (piece.hp <= 0) killPiece(piece, events);
      break;

    case 'glacier':
      // 100%로 두면 한번 얼면 영원히 못 벗어난다 — 확률제로 탈출 가능성을 남긴다.
      if (!isImmuneToStatus(piece, 'freeze') && rollDie(rng, 100) <= GLACIER_FREEZE_CHANCE) {
        piece.statuses.push({ kind: 'freeze', value: 0, turnsLeft: GLACIER_FREEZE_TURNS });
        events.push({ type: 'StatusApplied', pieceId: piece.id, kind: 'freeze', value: 0, turns: GLACIER_FREEZE_TURNS });
      }
      break;

    case 'scorched':
      if (!isImmuneToStatus(piece, 'burn')) {
        piece.statuses.push({ kind: 'burn', value: SCORCHED_BURN_VALUE, turnsLeft: SCORCHED_BURN_TURNS });
        events.push({
          type: 'StatusApplied',
          pieceId: piece.id,
          kind: 'burn',
          value: SCORCHED_BURN_VALUE,
          turns: SCORCHED_BURN_TURNS,
        });
      }
      break;

    case 'forest':
      break; // 회피 보정은 effectiveEva가 매번 계산하므로 턴 시작 시 할 일이 없다.
  }
}
