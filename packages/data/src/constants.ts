/** GDD에 명시된 수치 상수. 밸런스 노브는 전부 여기 모아 둔다. */

/** 보드 8×8 (GDD §8.2) */
export const BOARD_SIZE = 8;

/** 덱빌딩 (GDD §7.1) */
export const MAX_PIECES = 6;
export const DECK_BUDGET = 30;

/** 배치 구역: A는 rank 1~2(y 0~1), B는 rank 7~8(y 6~7) (GDD §8.2) */
export const DEPLOY_ROWS = 2;

/** 행동력 (GDD §2.2) — 부동소수 오차를 없애려고 1/10 단위 정수로 누적한다. */
export const AP_PER_SPEED_TENTHS = 1; // SPD 1당 0.1 AP
/** 후공 보정 +0.5 (GDD §8.4) */
export const SECOND_PLAYER_BONUS_TENTHS = 5;

/** 행동 비용 (GDD §2.4) */
export const AP_COST_MOVE = 1;
export const AP_COST_ATTACK = 1;
export const AP_COST_FOCUS = 1;

/** 정신력 (GDD §4) */
export const SP_REGEN_PER_TURN = 1;
export const SP_GAIN_ON_FOCUS = 3;

/** 회피 상한 60% (GDD §3.3) */
export const EVA_CAP = 60;

/** 거리 감쇠 배율, 체비셰프 거리 기준 (GDD §3.2) */
export const DISTANCE_FALLOFF: readonly number[] = [1.0, 1.0, 0.85, 0.7, 0.55, 0.4];
/** 5칸 이상은 전부 0.40 */
export const DISTANCE_FALLOFF_MIN = 0.4;

/** 서든데스: 40라운드 경과 후 매 턴 시작 시 전 기물 HP −2 (GDD §8.4) */
export const SUDDEN_DEATH_ROUND = 40;
export const SUDDEN_DEATH_DAMAGE = 2;

/** 무한 루프 방지용 하드 캡 (헤드리스 시뮬레이터에서 사용) */
export const MAX_ROUNDS = 200;

/** 지형 (신규 시스템) */
/** 지형 위에서는 이동 범위가 이만큼 줄어든다 (최소 1칸은 유지). */
export const TERRAIN_MOVE_PENALTY = 1;
export const TERRAIN_MIN_RANGE = 1;
/** 늪지: 매 턴 시작 시 고정 피해. */
export const SWAMP_DAMAGE = 2;
/** 숲: 서 있는 동안 회피율 보정 (상시 적용, effectiveEva에서 계산). */
export const FOREST_EVA_BONUS = 15;
/** 빙판: 매 턴 시작 시 이 확률(%)로 빙결 부여 — 100%면 절대 벗어날 수 없어 확률로 둔다. */
export const GLACIER_FREEZE_CHANCE = 50;
export const GLACIER_FREEZE_TURNS = 1;
/** 화염지대: 매 턴 시작 시 화상 부여. */
export const SCORCHED_BURN_VALUE = 2;
export const SCORCHED_BURN_TURNS = 2;

/** 지형 생성 — 지역처럼 뭉쳐서 분포하도록 씨앗에서 무작위로 번진다. */
export const TERRAIN_BLOB_MIN_SIZE = 13;
export const TERRAIN_BLOB_MAX_SIZE = 30;
/** 한 매치에 등장하는 지형 종류 수 — 4종 중 이만큼만 무작위로 골라 등장시킨다. */
export const TERRAIN_MAX_KINDS_PER_MATCH = 3;
/** 씨앗은 보드 전역에서 뽑는다 — 배치 구역도 지형 대상이다. */
export const TERRAIN_SEED_Y_MIN = 0;
export const TERRAIN_SEED_Y_MAX = 7;
