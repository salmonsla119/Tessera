-- 사용자 · 세션
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- 덱 (GDD §7)
CREATE TABLE decks (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  name       TEXT NOT NULL,
  pieces     TEXT NOT NULL, -- JSON DeckPiece[]
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_decks_user ON decks(user_id);

-- 매치. state는 match_actions 리플레이의 최신 스냅샷 캐시다 (PLAN §4.1 — 매 액션마다 갱신,
-- 상태가 작아 매 액션 스냅샷을 둬도 비용이 무시할 만하다).
CREATE TABLE matches (
  id             TEXT PRIMARY KEY,
  player_a       TEXT NOT NULL REFERENCES users(id),
  player_b       TEXT NOT NULL REFERENCES users(id),
  ranked         INTEGER NOT NULL DEFAULT 0,
  state          TEXT NOT NULL,   -- JSON MatchState
  action_count   INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL,   -- 'deploying' | 'battle' | 'finished' (state.phase 비정규화 — 인덱싱용)
  turn_deadline  INTEGER,         -- epoch ms. finished면 NULL (PLAN §8.4 24시간 제한시간)
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX idx_matches_a ON matches(player_a, status);
CREATE INDEX idx_matches_b ON matches(player_b, status);
CREATE INDEX idx_matches_deadline ON matches(status, turn_deadline);

-- 액션 로그. append-only (PLAN §4.1) — 분쟁 검증·리플레이의 근거.
CREATE TABLE match_actions (
  match_id   TEXT NOT NULL REFERENCES matches(id),
  seq        INTEGER NOT NULL,
  player     TEXT NOT NULL, -- 'A' | 'B'
  action     TEXT NOT NULL, -- JSON Action
  events     TEXT NOT NULL, -- JSON GameEvent[]
  created_at INTEGER NOT NULL,
  PRIMARY KEY (match_id, seq)
);

-- 친구 대전 초대 코드 (GDD §8.1, PLAN §5.8)
CREATE TABLE match_invites (
  code       TEXT PRIMARY KEY,
  host_id    TEXT NOT NULL REFERENCES users(id),
  deck_id    TEXT NOT NULL REFERENCES decks(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
