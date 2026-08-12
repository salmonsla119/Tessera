import type { DeckPiece, StatusKind, TerrainKind } from '@tessera/data';

export type PlayerId = 'A' | 'B';

export interface Coord {
  x: number;
  y: number;
}

export type PieceId = string;

export type MatchPhase = 'deploying' | 'battle' | 'finished';

export interface StatusEffect {
  kind: StatusKind;
  /** evaDown·burn·bleed의 세기. freeze는 켜져 있는 것 자체가 효과라 0을 쓴다. */
  value: number;
  /** 대상 플레이어의 턴 시작마다 1씩 감소한다 (GDD §9 미확정 항목 — 대상 턴 기준으로 확정). */
  turnsLeft: number;
}

export interface PieceState {
  id: PieceId;
  owner: PlayerId;
  baseId: string;
  /** 편성된 스킬. 기본 공격(`basic`)은 여기에 없어도 항상 사용할 수 있다. */
  skillId: string;
  hp: number;
  maxHp: number;
  sp: number;
  maxSp: number;
  atk: number;
  /** 상태이상이 붙기 전의 기본 회피율. 실효 회피율은 effectiveEva()로 구한다. */
  baseEva: number;
  spd: number;
  /** 배치 전이거나 전사한 기물은 null. */
  pos: Coord | null;
  alive: boolean;
  statuses: StatusEffect[];
}

export interface DamageRange {
  min: number;
  max: number;
}

export interface MatchState {
  seed: number;
  /** 시드 PRNG의 호출 횟수. 상태에 담겨 있으므로 리플레이가 결정론적이다. */
  rngCursor: number;
  phase: MatchPhase;
  first: PlayerId;
  turnOwner: PlayerId;
  /** 플레이어 턴 누적 횟수 (1부터). */
  turn: number;
  /** 라운드 = 양측이 1턴씩 진행한 단위 (1부터). */
  round: number;
  pieces: PieceState[];
  /**
   * 지형 (신규 시스템). 매치 시작 시 시드로 확정되며 이후 바뀌지 않는다.
   * `coordKey(좌표)`를 키로 쓰고, 없는 칸은 평지(`plain`)로 취급한다.
   */
  terrain: Record<string, TerrainKind>;
  /** 매치 시작 시 확정. 기물이 죽어도 줄지 않는다 (GDD §2.2). */
  teamSpeed: Record<PlayerId, number>;
  /** 1/10 AP 단위 정수 누적값. 부동소수 오차 없이 이월을 계산한다. */
  apPoolTenths: Record<PlayerId, number>;
  /** 이번 턴에 남은 행동 횟수. */
  ap: Record<PlayerId, number>;
  deployedPlayers: PlayerId[];
  winner: PlayerId | 'draw' | null;
  suddenDeath: boolean;
}

export interface Placement {
  pieceId: PieceId;
  pos: Coord;
}

export type Action =
  | { type: 'deploy'; player: PlayerId; placements: Placement[] }
  | { type: 'move'; player: PlayerId; pieceId: PieceId; to: Coord }
  | { type: 'attack'; player: PlayerId; pieceId: PieceId; skillId: string; targetId: PieceId }
  | { type: 'focus'; player: PlayerId; pieceId: PieceId }
  | { type: 'endTurn'; player: PlayerId };

export type DiceKind = 'initiative' | 'damage' | 'evade';

export type GameEvent =
  | { type: 'MatchCreated'; first: PlayerId }
  | { type: 'Deployed'; player: PlayerId }
  | { type: 'BattleStarted' }
  | { type: 'TurnStarted'; player: PlayerId; turn: number; round: number; ap: number; carryTenths: number }
  | { type: 'SuddenDeath'; round: number; damage: number }
  | { type: 'SpRegen'; pieceId: PieceId; sp: number }
  | { type: 'PieceMoved'; pieceId: PieceId; from: Coord; to: Coord }
  | { type: 'Focused'; pieceId: PieceId; sp: number }
  | {
      type: 'SkillUsed';
      pieceId: PieceId;
      skillId: string;
      targetId: PieceId;
      from: Coord;
      to: Coord;
      distance: number;
      preview: DamageRange;
    }
  | { type: 'DiceRolled'; kind: DiceKind; value: number; sides: number }
  | { type: 'Evaded'; pieceId: PieceId }
  | { type: 'Damaged'; pieceId: PieceId; amount: number; hp: number }
  | { type: 'Healed'; pieceId: PieceId; amount: number; hp: number }
  | { type: 'StatusApplied'; pieceId: PieceId; kind: StatusEffect['kind']; value: number; turns: number }
  | { type: 'SpDrained'; pieceId: PieceId; amount: number; sp: number }
  | { type: 'PieceDown'; pieceId: PieceId }
  | { type: 'TurnEnded'; player: PlayerId }
  | { type: 'MatchEnded'; winner: PlayerId | 'draw' };

export interface ApplyResult {
  state: MatchState;
  events: GameEvent[];
}

/** 매치에 투입되는 덱 스냅샷 (PLAN §5.2 — 큐 등록 시점에 복사된다). */
export interface DeckSnapshot {
  name: string;
  pieces: DeckPiece[];
}
