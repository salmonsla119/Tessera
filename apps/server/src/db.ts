import type { DeckPiece } from '@tessera/data';
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

export async function createDeck(
  db: D1Database,
  row: { id: string; userId: string; name: string; pieces: DeckPiece[] },
  now: number,
): Promise<void> {
  await db
    .prepare('INSERT INTO decks (id, user_id, name, pieces, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
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
