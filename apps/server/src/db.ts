import { STARTER_BASE_IDS, STARTER_SKILL_IDS, STARTER_CURRENCY, type DeckPiece } from '@tessera/data';
import type { MatchState, PlayerId } from '@tessera/rules';

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  created_at: number;
}

export async function getUserByUsername(db: D1Database, username: string): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<UserRow>();
}

export async function getUserById(db: D1Database, id: string): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
}

export async function createUser(db: D1Database, row: { id: string; username: string; passwordHash: string }, now: number): Promise<void> {
  await db
    .prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .bind(row.id, row.username, row.passwordHash, now)
    .run();
}

export interface SessionRow {
  token: string;
  user_id: string;
  expires_at: number;
}

export async function createSession(
  db: D1Database,
  row: { token: string; userId: string },
  now: number,
  ttlMs: number,
): Promise<void> {
  await db
    .prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(row.token, row.userId, now, now + ttlMs)
    .run();
}

export async function getValidSession(db: D1Database, token: string, now: number): Promise<SessionRow | null> {
  const row = await db.prepare('SELECT * FROM sessions WHERE token = ?').bind(token).first<SessionRow>();
  if (!row || row.expires_at < now) return null;
  return row;
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
}

export interface DeckRow {
  id: string;
  user_id: string;
  name: string;
  pieces: string;
  created_at: number;
  updated_at: number;
}

export function parseDeckPieces(row: DeckRow): DeckPiece[] {
  return JSON.parse(row.pieces) as DeckPiece[];
}

export async function listDecks(db: D1Database, userId: string): Promise<DeckRow[]> {
  const result = await db
    .prepare('SELECT * FROM decks WHERE user_id = ? ORDER BY updated_at DESC')
    .bind(userId)
    .all<DeckRow>();
  return result.results;
}

export async function getDeck(db: D1Database, id: string, userId: string): Promise<DeckRow | null> {
  return db.prepare('SELECT * FROM decks WHERE id = ? AND user_id = ?').bind(id, userId).first<DeckRow>();
}

/**
 * 클라이언트가 미리 만든 id로 저장한다 (LocalBackend와 같은 저장 UX를 온라인에서도 쓰기 위함 —
 * 새 덱이든 기존 덱 수정이든 클라이언트는 그냥 저장만 하면 된다). id가 다른 유저 소유라면
 * 조용히 아무 일도 하지 않는다 — 클라이언트가 무작위로 생성한 id라 충돌 자체가 극히 드물고,
 * 충돌해도 남의 덱을 훔쳐 쓰는 것보다는 저장이 무시되는 쪽이 안전하다.
 */
export async function upsertDeck(
  db: D1Database,
  row: { id: string; userId: string; name: string; pieces: DeckPiece[] },
  now: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO decks (id, user_id, name, pieces, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, pieces = excluded.pieces, updated_at = excluded.updated_at
       WHERE decks.user_id = excluded.user_id`,
    )
    .bind(row.id, row.userId, row.name, JSON.stringify(row.pieces), now, now)
    .run();
}

export async function updateDeck(
  db: D1Database,
  id: string,
  userId: string,
  row: { name: string; pieces: DeckPiece[] },
  now: number,
): Promise<D1Result> {
  return db
    .prepare('UPDATE decks SET name = ?, pieces = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .bind(row.name, JSON.stringify(row.pieces), now, id, userId)
    .run();
}

export async function deleteDeck(db: D1Database, id: string, userId: string): Promise<D1Result> {
  return db.prepare('DELETE FROM decks WHERE id = ? AND user_id = ?').bind(id, userId).run();
}

export type MatchStatus = 'deploying' | 'battle' | 'finished';

export interface MatchRow {
  id: string;
  player_a: string;
  player_b: string;
  ranked: number;
  state: string;
  action_count: number;
  status: MatchStatus;
  turn_deadline: number | null;
  created_at: number;
  updated_at: number;
}

export function parseMatchState(row: MatchRow): MatchState {
  return JSON.parse(row.state) as MatchState;
}

export function roleOf(row: MatchRow, userId: string): PlayerId | null {
  if (row.player_a === userId) return 'A';
  if (row.player_b === userId) return 'B';
  return null;
}

/** 활성 매치 상한 확인용 (PLAN §5.2 — 기본 10개). */
export async function countActiveMatches(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) as n FROM matches
       WHERE status != 'finished' AND (player_a = ? OR player_b = ?)`,
    )
    .bind(userId, userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** 직전 상대 재매칭 회피용 (PLAN §5.3). */
export async function getLastOpponent(db: D1Database, userId: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT player_a, player_b FROM matches
       WHERE player_a = ? OR player_b = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(userId, userId)
    .first<{ player_a: string; player_b: string }>();
  if (!row) return null;
  return row.player_a === userId ? row.player_b : row.player_a;
}

export async function insertMatch(db: D1Database, row: MatchRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO matches
        (id, player_a, player_b, ranked, state, action_count, status, turn_deadline, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.player_a,
      row.player_b,
      row.ranked,
      row.state,
      row.action_count,
      row.status,
      row.turn_deadline,
      row.created_at,
      row.updated_at,
    )
    .run();
}

export async function getMatch(db: D1Database, id: string): Promise<MatchRow | null> {
  return db.prepare('SELECT * FROM matches WHERE id = ?').bind(id).first<MatchRow>();
}

export async function listMatchesForUser(db: D1Database, userId: string): Promise<MatchRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM matches WHERE player_a = ? OR player_b = ? ORDER BY updated_at DESC`,
    )
    .bind(userId, userId)
    .all<MatchRow>();
  return result.results;
}

export async function listMatchesPastDeadline(db: D1Database, now: number, limit: number): Promise<MatchRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM matches
       WHERE status != 'finished' AND turn_deadline IS NOT NULL AND turn_deadline < ?
       LIMIT ?`,
    )
    .bind(now, limit)
    .all<MatchRow>();
  return result.results;
}

/**
 * 액션 적용 후 상태를 갱신하고 로그를 남긴다. 한 매치에 대해 두 statement가
 * 원자적으로 적용되어야 하므로 batch로 묶는다.
 */
export async function persistAction(
  db: D1Database,
  params: {
    matchId: string;
    seq: number;
    player: PlayerId;
    action: unknown;
    events: unknown;
    newState: MatchState;
    status: MatchStatus;
    turnDeadline: number | null;
    now: number;
  },
): Promise<void> {
  await db.batch([
    db
      .prepare(
        'INSERT INTO match_actions (match_id, seq, player, action, events, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(params.matchId, params.seq, params.player, JSON.stringify(params.action), JSON.stringify(params.events), params.now),
    db
      .prepare(
        `UPDATE matches SET state = ?, action_count = ?, status = ?, turn_deadline = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        JSON.stringify(params.newState),
        params.seq,
        params.status,
        params.turnDeadline,
        params.now,
        params.matchId,
      ),
  ]);
}

export async function listActions(db: D1Database, matchId: string): Promise<{ seq: number; player: string; events: string; created_at: number }[]> {
  const result = await db
    .prepare('SELECT seq, player, events, created_at FROM match_actions WHERE match_id = ? ORDER BY seq ASC')
    .bind(matchId)
    .all<{ seq: number; player: string; events: string; created_at: number }>();
  return result.results;
}

export interface InviteRow {
  code: string;
  host_id: string;
  deck_id: string;
  created_at: number;
  expires_at: number;
}

export async function createInvite(db: D1Database, row: { code: string; hostId: string; deckId: string }, now: number, ttlMs: number): Promise<void> {
  await db
    .prepare('INSERT INTO match_invites (code, host_id, deck_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(row.code, row.hostId, row.deckId, now, now + ttlMs)
    .run();
}

export async function getValidInvite(db: D1Database, code: string, now: number): Promise<InviteRow | null> {
  const row = await db.prepare('SELECT * FROM match_invites WHERE code = ?').bind(code).first<InviteRow>();
  if (!row || row.expires_at < now) return null;
  return row;
}

export async function deleteInvite(db: D1Database, code: string): Promise<void> {
  await db.prepare('DELETE FROM match_invites WHERE code = ?').bind(code).run();
}

export type GachaItemType = 'base' | 'skill';

/** 계정 생성 시 1회 호출 — 시작 재화와 시작 지급 4베이스/4스킬을 한 배치로 부여한다. */
export async function grantStarterAccount(db: D1Database, userId: string, now: number): Promise<void> {
  await db.batch([
    db.prepare('INSERT INTO currency (user_id, balance, updated_at) VALUES (?, ?, ?)').bind(userId, STARTER_CURRENCY, now),
    ...STARTER_BASE_IDS.map((id) =>
      db
        .prepare('INSERT INTO inventory (user_id, item_type, item_id, unlocked_at) VALUES (?, ?, ?, ?)')
        .bind(userId, 'base', id, now),
    ),
    ...STARTER_SKILL_IDS.map((id) =>
      db
        .prepare('INSERT INTO inventory (user_id, item_type, item_id, unlocked_at) VALUES (?, ?, ?, ?)')
        .bind(userId, 'skill', id, now),
    ),
  ]);
}

export async function getCurrency(db: D1Database, userId: string): Promise<number> {
  const row = await db.prepare('SELECT balance FROM currency WHERE user_id = ?').bind(userId).first<{ balance: number }>();
  return row?.balance ?? 0;
}

/** 잔액이 충분할 때만 원자적으로 차감한다 (동시 요청으로 잔액을 초과 소비하는 레이스 방지). */
export async function trySpendCurrency(db: D1Database, userId: string, amount: number, now: number): Promise<boolean> {
  const result = await db
    .prepare('UPDATE currency SET balance = balance - ?, updated_at = ? WHERE user_id = ? AND balance >= ?')
    .bind(amount, now, userId, amount)
    .run();
  return result.meta.changes > 0;
}

export async function addCurrency(db: D1Database, userId: string, amount: number, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO currency (user_id, balance, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at`,
    )
    .bind(userId, amount, now)
    .run();
}

export interface InventoryRow {
  item_type: GachaItemType;
  item_id: string;
}

export async function listInventory(db: D1Database, userId: string): Promise<InventoryRow[]> {
  const result = await db
    .prepare('SELECT item_type, item_id FROM inventory WHERE user_id = ?')
    .bind(userId)
    .all<InventoryRow>();
  return result.results;
}

export async function isOwned(db: D1Database, userId: string, itemType: GachaItemType, itemId: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM inventory WHERE user_id = ? AND item_type = ? AND item_id = ?')
    .bind(userId, itemType, itemId)
    .first();
  return row !== null;
}

export async function unlockItem(
  db: D1Database,
  userId: string,
  itemType: GachaItemType,
  itemId: string,
  now: number,
): Promise<void> {
  await db
    .prepare('INSERT OR IGNORE INTO inventory (user_id, item_type, item_id, unlocked_at) VALUES (?, ?, ?, ?)')
    .bind(userId, itemType, itemId, now)
    .run();
}

export async function insertGachaPull(
  db: D1Database,
  row: {
    id: string;
    userId: string;
    itemType: GachaItemType;
    itemId: string;
    rarity: string;
    duplicate: boolean;
    refund: number;
  },
  now: number,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO gacha_pulls (id, user_id, item_type, item_id, rarity, duplicate, refund, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(row.id, row.userId, row.itemType, row.itemId, row.rarity, row.duplicate ? 1 : 0, row.refund, now)
    .run();
}

/** 매치 완료 보상 지급. 이미 지급된 키면 아무 것도 하지 않고 false를 반환한다 (중복 지급 방지). */
export async function claimMatchReward(db: D1Database, userId: string, matchKey: string, now: number): Promise<boolean> {
  const result = await db
    .prepare('INSERT OR IGNORE INTO match_rewards_claimed (user_id, match_key, created_at) VALUES (?, ?, ?)')
    .bind(userId, matchKey, now)
    .run();
  return result.meta.changes > 0;
}

/** 덱에 쓰인 베이스/스킬을 전부 보유하고 있는지 확인한다 (서버 재검증 — PLAN §4.2 연장선). */
export async function ownsAllPieces(db: D1Database, userId: string, pieces: readonly DeckPiece[]): Promise<boolean> {
  const owned = await listInventory(db, userId);
  const ownedBases = new Set(owned.filter((r) => r.item_type === 'base').map((r) => r.item_id));
  const ownedSkills = new Set(owned.filter((r) => r.item_type === 'skill').map((r) => r.item_id));
  return pieces.every((p) => ownedBases.has(p.baseId) && ownedSkills.has(p.skillId));
}
