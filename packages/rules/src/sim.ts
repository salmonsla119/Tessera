import {
  BASES,
  DECK_BUDGET,
  MAX_PIECES,
  MAX_ROUNDS,
  SELECTABLE_SKILLS,
  requireSkill,
  validateDeck,
  type DeckPiece,
} from '@tessera/data';
import { legalActions } from './actions';
import { chebyshev, deployZoneCells } from './board';
import { previewDamage } from './damage';
import { mulberry32 } from './rng';
import { applyAction } from './resolve';
import { createMatch, getPiece, livingPieces } from './state';
import type { Action, DeckSnapshot, MatchState, PlayerId } from './types';

/** 예산 안에서 무작위 덱을 만든다. 밸런스 시뮬레이션의 입력. */
export function randomDeck(rand: () => number, name: string): DeckSnapshot {
  const combos: DeckPiece[] = [];
  for (const base of BASES) {
    for (const skill of SELECTABLE_SKILLS) {
      combos.push({ baseId: base.id, skillId: skill.id });
    }
  }

  const pieces: DeckPiece[] = [];
  let budget = DECK_BUDGET;
  for (let attempt = 0; attempt < 200 && pieces.length < MAX_PIECES; attempt++) {
    const candidate = combos[Math.floor(rand() * combos.length)]!;
    const cost =
      BASES.find((b) => b.id === candidate.baseId)!.cost + requireSkill(candidate.skillId).cost;
    if (cost > budget) continue;
    pieces.push(candidate);
    budget -= cost;
  }

  // 아주 낮은 확률로 아무것도 못 담는 경우를 대비한 최소 보장.
  if (pieces.length === 0) pieces.push({ baseId: 'guard', skillId: 'cleave' });

  return { name, pieces };
}

/** 자진 2열의 앞줄부터 채워 넣는 기본 배치. */
function autoDeploy(state: MatchState, player: PlayerId): Action {
  const own = state.pieces.filter((p) => p.owner === player);
  const cells = deployZoneCells(player);
  // A는 y가 큰 줄(전방)부터, B는 y가 작은 줄(전방)부터 채운다.
  const ordered = player === 'A' ? [...cells].reverse() : cells;
  return {
    type: 'deploy',
    player,
    placements: own.map((piece, index) => ({ pieceId: piece.id, pos: ordered[index]! })),
  };
}

/**
 * 탐욕적 AI — 때릴 수 있으면 기대 데미지가 가장 큰 공격을, 없으면 접근을 택한다.
 * 밸런스 측정을 위한 기준선이지 좋은 플레이어가 아니다.
 */
function chooseAction(state: MatchState, player: PlayerId, rand: () => number): Action {
  const actions = legalActions(state, player);
  const attacks = actions.filter((a) => a.type === 'attack');
  const damageAttacks = attacks.filter((a) => a.type === 'attack' && requireSkill(a.skillId).kind !== 'heal');
  const healAttacks = attacks.filter((a) => a.type === 'attack' && requireSkill(a.skillId).kind === 'heal');

  if (damageAttacks.length > 0) {
    let best = damageAttacks[0]!;
    let bestScore = -Infinity;
    for (const action of damageAttacks) {
      if (action.type !== 'attack') continue;
      const attacker = getPiece(state, action.pieceId)!;
      const target = getPiece(state, action.targetId)!;
      const skill = requireSkill(action.skillId);
      const distance = chebyshev(attacker.pos!, target.pos!);
      const preview = previewDamage(state, attacker, skill, distance);
      const expected = (preview.min + preview.max) / 2;
      // 마무리 일격에 가산점을 줘서 딜 낭비를 줄인다.
      const lethalBonus = expected >= target.hp ? 100 : 0;
      const score = expected + lethalBonus + rand() * 0.01;
      if (score > bestScore) {
        bestScore = score;
        best = action;
      }
    }
    return best;
  }

  // 때릴 대상이 없고 많이 다친 아군이 있으면 치유를 우선한다.
  if (healAttacks.length > 0) {
    let best = healAttacks[0]!;
    let bestMissingRatio = 0.3;
    for (const action of healAttacks) {
      if (action.type !== 'attack') continue;
      const target = getPiece(state, action.targetId)!;
      const missingRatio = 1 - target.hp / target.maxHp;
      if (missingRatio > bestMissingRatio) {
        bestMissingRatio = missingRatio;
        best = action;
      }
    }
    if (bestMissingRatio > 0.3) return best;
  }

  const moves = actions.filter((a) => a.type === 'move');
  if (moves.length > 0) {
    const enemies = livingPieces(state, player === 'A' ? 'B' : 'A');
    if (enemies.length > 0) {
      let best = moves[0]!;
      let bestDistance = Infinity;
      for (const action of moves) {
        if (action.type !== 'move') continue;
        const nearest = Math.min(...enemies.map((e) => chebyshev(action.to, e.pos!)));
        const score = nearest + rand() * 0.01;
        if (score < bestDistance) {
          bestDistance = score;
          best = action;
        }
      }
      return best;
    }
  }

  const focuses = actions.filter((a) => a.type === 'focus');
  if (focuses.length > 0) return focuses[Math.floor(rand() * focuses.length)]!;

  return { type: 'endTurn', player };
}

export interface GameResult {
  winner: PlayerId | 'draw' | null;
  first: PlayerId;
  firstWon: boolean;
  rounds: number;
  turns: number;
  suddenDeath: boolean;
  /** 하드 캡에 걸려 강제 종료됐는지 — true가 나오면 규칙에 진행이 멈추는 구멍이 있다는 뜻이다. */
  timedOut: boolean;
  survivorsByBase: Record<string, { survived: number; total: number }>;
  /** 승리 팀에서 단일 기물이 소비한 AP 비율의 최댓값 (PLAN §9-1). */
  winnerTopPieceApShare: number;
}

export function playGame(seed: number): GameResult {
  const rand = mulberry32(seed);
  const deckA = randomDeck(rand, 'A');
  const deckB = randomDeck(rand, 'B');

  let state = createMatch(deckA, deckB, seed);
  state = applyAction(state, autoDeploy(state, 'A')).state;
  state = applyAction(state, autoDeploy(state, 'B')).state;

  const apByPiece = new Map<string, number>();
  let timedOut = false;

  while (state.phase !== 'finished') {
    if (state.round > MAX_ROUNDS) {
      timedOut = true;
      break;
    }
    const player = state.turnOwner;
    const action = chooseAction(state, player, rand);
    if ('pieceId' in action) {
      apByPiece.set(action.pieceId, (apByPiece.get(action.pieceId) ?? 0) + 1);
    }
    state = applyAction(state, action).state;
  }

  const survivorsByBase: GameResult['survivorsByBase'] = {};
  for (const piece of state.pieces) {
    const entry = (survivorsByBase[piece.baseId] ??= { survived: 0, total: 0 });
    entry.total += 1;
    if (piece.alive) entry.survived += 1;
  }

  let winnerTopPieceApShare = 0;
  if (state.winner === 'A' || state.winner === 'B') {
    const owned = state.pieces.filter((p) => p.owner === state.winner);
    const total = owned.reduce((sum, p) => sum + (apByPiece.get(p.id) ?? 0), 0);
    if (total > 0) {
      const top = Math.max(...owned.map((p) => apByPiece.get(p.id) ?? 0));
      winnerTopPieceApShare = top / total;
    }
  }

  return {
    winner: state.winner,
    first: state.first,
    firstWon: state.winner === state.first,
    rounds: state.round,
    turns: state.turn,
    suddenDeath: state.suddenDeath,
    timedOut,
    survivorsByBase,
    winnerTopPieceApShare,
  };
}

export interface SimSummary {
  games: number;
  avgRounds: number;
  maxRounds: number;
  firstWinRate: number;
  drawRate: number;
  suddenDeathRate: number;
  timeoutRate: number;
  apHogRate: number;
  survivalByBase: Record<string, number>;
}

/** 헤드리스 자동 대전 (PLAN §8.2). */
export function runSimulation(games: number, baseSeed = 1): SimSummary {
  const results: GameResult[] = [];
  for (let i = 0; i < games; i++) results.push(playGame(baseSeed + i));

  const decided = results.filter((r) => r.winner === 'A' || r.winner === 'B');
  const survival: Record<string, { survived: number; total: number }> = {};
  for (const result of results) {
    for (const [baseId, entry] of Object.entries(result.survivorsByBase)) {
      const acc = (survival[baseId] ??= { survived: 0, total: 0 });
      acc.survived += entry.survived;
      acc.total += entry.total;
    }
  }

  const survivalByBase: Record<string, number> = {};
  for (const [baseId, entry] of Object.entries(survival)) {
    survivalByBase[baseId] = entry.total === 0 ? 0 : entry.survived / entry.total;
  }

  return {
    games,
    avgRounds: results.reduce((s, r) => s + r.rounds, 0) / games,
    maxRounds: Math.max(...results.map((r) => r.rounds)),
    firstWinRate: decided.length === 0 ? 0 : decided.filter((r) => r.firstWon).length / decided.length,
    drawRate: results.filter((r) => r.winner === 'draw').length / games,
    suddenDeathRate: results.filter((r) => r.suddenDeath).length / games,
    timeoutRate: results.filter((r) => r.timedOut).length / games,
    apHogRate: decided.length === 0 ? 0 : decided.filter((r) => r.winnerTopPieceApShare >= 0.7).length / decided.length,
    survivalByBase,
  };
}

/** 시뮬레이터가 만든 덱이 실제로 유효한지 확인하는 자체 점검용. */
export function assertDeckValid(deck: DeckSnapshot): void {
  const result = validateDeck(deck.pieces);
  if (!result.ok) throw new Error(`유효하지 않은 덱: ${result.errors.join(', ')}`);
}
