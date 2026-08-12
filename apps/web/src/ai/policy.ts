import { requireSkill } from '@tessera/data';
import {
  chebyshev,
  deployZoneCells,
  effectiveEva,
  getPiece,
  legalActions,
  livingPieces,
  previewDamage,
  targetableCells,
  usableSkills,
  type Action,
  type MatchState,
  type PieceState,
  type PlayerId,
} from '@tessera/rules';

export type Difficulty = 'easy' | 'medium' | 'hard';

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: '하',
  medium: '중',
  hard: '상',
};

export type AiPlayer = (state: MatchState, role: PlayerId) => Action;

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)]!;
}

function opponentOf(player: PlayerId): PlayerId {
  return player === 'A' ? 'B' : 'A';
}

/** 자진 2열에 기물을 배치한다. HP가 높은 기물을 전열(적과 가까운 줄)에 둔다. */
function planDeploy(state: MatchState, role: PlayerId, frontFirst: boolean): Action {
  const own = state.pieces.filter((p) => p.owner === role);
  const cells = deployZoneCells(role);
  // role별로 "전열"이 적과 가까운 줄이 되도록 정렬한다 (A는 y가 클수록 전열, B는 작을수록 전열).
  const orderedCells = [...cells].sort((a, b) => (role === 'A' ? b.y - a.y : a.y - b.y));
  const orderedPieces = frontFirst ? [...own].sort((a, b) => b.hp - a.hp) : own;

  return {
    type: 'deploy',
    player: role,
    placements: orderedPieces.map((piece, i) => ({ pieceId: piece.id, pos: orderedCells[i]! })),
  };
}

/** 상대 기물이 현재 위치에서 위협하는 칸 (이동은 고려하지 않는 근사치). */
function threatCells(state: MatchState, enemyRole: PlayerId): Set<string> {
  const cells = new Set<string>();
  for (const enemy of livingPieces(state, enemyRole)) {
    if (!enemy.pos) continue;
    for (const skill of usableSkills(enemy)) {
      for (const cell of targetableCells(state, enemy.pos, skill)) cells.add(`${cell.x},${cell.y}`);
    }
  }
  return cells;
}

function bestAttack(
  state: MatchState,
  attacks: Extract<Action, { type: 'attack' }>[],
  rand: () => number,
): { action: Extract<Action, { type: 'attack' }>; expected: number; lethal: boolean } | null {
  let best: { action: Extract<Action, { type: 'attack' }>; expected: number; lethal: boolean } | null = null;
  for (const action of attacks) {
    const attacker = getPiece(state, action.pieceId)!;
    const target = getPiece(state, action.targetId)!;
    const skill = requireSkill(action.skillId);
    const distance = chebyshev(attacker.pos!, target.pos!);
    const preview = previewDamage(attacker, skill, distance);
    const hitChance = 1 - effectiveEva(target) / 100;
    const expected = ((preview.min + preview.max) / 2) * hitChance;
    const lethal = preview.min * hitChance >= target.hp || expected >= target.hp;
    const score = expected + (lethal ? 1000 + requireSkill(target.skillId).cost : 0) + rand() * 0.01;
    if (!best || score > best.expected) best = { action, expected: score, lethal };
  }
  return best;
}

/** 완전 무작위 — 이길 수도 있지만 대부분 진다. */
function easyPolicy(rand: () => number): AiPlayer {
  return (state, role) => {
    if (state.phase === 'deploying') return planDeploy(state, role, false);

    const actions = legalActions(state, role).filter((a) => a.type !== 'endTurn');
    if (actions.length === 0) return { type: 'endTurn', player: role };
    return pick(rand, actions);
  };
}

/** 때릴 수 있으면 기대값이 가장 큰 공격을, 없으면 가장 가까운 적에게 접근한다. */
function mediumPolicy(rand: () => number): AiPlayer {
  return (state, role) => {
    if (state.phase === 'deploying') return planDeploy(state, role, true);

    const actions = legalActions(state, role);
    const attacks = actions.filter((a): a is Extract<Action, { type: 'attack' }> => a.type === 'attack');
    if (attacks.length > 0) return bestAttack(state, attacks, rand)!.action;

    const moves = actions.filter((a): a is Extract<Action, { type: 'move' }> => a.type === 'move');
    const enemies = livingPieces(state, opponentOf(role));
    if (moves.length > 0 && enemies.length > 0) {
      let best = moves[0]!;
      let bestDistance = Infinity;
      for (const action of moves) {
        const nearest = Math.min(...enemies.map((e) => chebyshev(action.to, e.pos!)));
        const score = nearest + rand() * 0.01;
        if (score < bestDistance) {
          bestDistance = score;
          best = action;
        }
      }
      return best;
    }

    const focuses = actions.filter((a) => a.type === 'focus');
    if (focuses.length > 0) return pick(rand, focuses);

    return { type: 'endTurn', player: role };
  };
}

/**
 * medium 위에 두 가지를 더한다:
 *  - 마무리 가능한 공격을 최우선으로, 그중에서도 비싼(위협적인) 기물부터 정리한다.
 *  - 체력이 낮은 아군이 (현재 위치 기준) 적 사거리 안에 있으면, 벗어날 수 있는 이동이 있는지
 *    먼저 확인한다 — 없으면 그대로 medium과 동일하게 진행한다.
 */
function hardPolicy(rand: () => number): AiPlayer {
  return (state, role) => {
    if (state.phase === 'deploying') return planDeploy(state, role, true);

    const actions = legalActions(state, role);
    const attacks = actions.filter((a): a is Extract<Action, { type: 'attack' }> => a.type === 'attack');
    if (attacks.length > 0) {
      const best = bestAttack(state, attacks, rand)!;
      if (best.lethal) return best.action;
    }

    const threats = threatCells(state, opponentOf(role));
    const endangered = livingPieces(state, role).filter(
      (p) => p.pos && p.hp <= p.maxHp * 0.3 && threats.has(`${p.pos.x},${p.pos.y}`),
    );

    const moves = actions.filter((a): a is Extract<Action, { type: 'move' }> => a.type === 'move');
    if (endangered.length > 0) {
      const retreat = findRetreat(moves, endangered, threats, rand);
      if (retreat) return retreat;
    }

    if (attacks.length > 0) return bestAttack(state, attacks, rand)!.action;

    const enemies = livingPieces(state, opponentOf(role));
    if (moves.length > 0 && enemies.length > 0) {
      const weakest = enemies.reduce((a, b) => (a.hp < b.hp ? a : b));
      let best = moves[0]!;
      let bestScore = Infinity;
      for (const action of moves) {
        const score = chebyshev(action.to, weakest.pos!) + rand() * 0.01;
        if (score < bestScore) {
          bestScore = score;
          best = action;
        }
      }
      return best;
    }

    const focuses = actions.filter((a) => a.type === 'focus');
    if (focuses.length > 0) return pick(rand, focuses);

    return { type: 'endTurn', player: role };
  };
}

function findRetreat(
  moves: Extract<Action, { type: 'move' }>[],
  endangered: PieceState[],
  threats: Set<string>,
  rand: () => number,
): Action | null {
  const endangeredIds = new Set(endangered.map((p) => p.id));
  const safe = moves.filter((m) => endangeredIds.has(m.pieceId) && !threats.has(`${m.to.x},${m.to.y}`));
  return safe.length > 0 ? pick(rand, safe) : null;
}

const POLICY_BUILDERS: Record<Difficulty, (rand: () => number) => AiPlayer> = {
  easy: easyPolicy,
  medium: mediumPolicy,
  hard: hardPolicy,
};

/** 매치마다 새로 만든다 — 내부 rand()가 매치 시드와 무관한 연출용 타이브레이커라 재사용할 이유가 없다. */
export function createAiPlayer(difficulty: Difficulty): AiPlayer {
  const rand = mulberry32ish();
  return POLICY_BUILDERS[difficulty](rand);
}

/** 연출/타이브레이커 전용 — 판정에 영향을 주지 않으므로 브라우저 CSPRNG로 시드를 뽑아도 된다. */
function mulberry32ish(): () => number {
  let a = crypto.getRandomValues(new Uint32Array(1))[0]!;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** AI 상대에게 쥐여 줄 고정 덱 — 난이도와 무관하게 하나로 통일한다 (실력 차이는 정책에서만 난다). */
export const AI_DECK_PIECES: { baseId: string; skillId: string }[] = [
  { baseId: 'guard', skillId: 'cleave' },
  { baseId: 'lancer', skillId: 'pierce' },
  { baseId: 'ranger', skillId: 'bolt' },
  { baseId: 'acolyte', skillId: 'hex' },
  { baseId: 'rider', skillId: 'cleave' },
];
