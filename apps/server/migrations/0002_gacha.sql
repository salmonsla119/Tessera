-- 등급/가챠 시스템 (신규 시스템). 계정에 귀속되므로 서버에 영속화한다.

-- 계정 재화. 코인 단위는 순전히 내부용 정수다 (packages/data/src/constants.ts 참고).
CREATE TABLE currency (
  user_id    TEXT PRIMARY KEY REFERENCES users(id),
  balance    INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 계정별 보유 베이스/스킬. 시작 지급 4+4종은 계정 생성 시 바로 여기 채워 넣는다 —
-- "보유 여부"를 매번 시작 지급 목록과 별도로 특례 처리하지 않고 이 표 하나로 통일한다.
CREATE TABLE inventory (
  user_id     TEXT NOT NULL REFERENCES users(id),
  item_type   TEXT NOT NULL, -- 'base' | 'skill'
  item_id     TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, item_type, item_id)
);
CREATE INDEX idx_inventory_user ON inventory(user_id);

-- 가챠 뽑기 기록 (히스토리 로그 — 중복 방지 용도가 아니다).
CREATE TABLE gacha_pulls (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  item_type  TEXT NOT NULL,
  item_id    TEXT NOT NULL,
  rarity     TEXT NOT NULL,
  duplicate  INTEGER NOT NULL, -- 0|1
  refund     INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_gacha_pulls_user ON gacha_pulls(user_id, created_at);

-- 매치 완료 보상 지급 기록 (중복 지급 방지용 dedup 키). 온라인 매치는 matches.id를 그대로 쓰고,
-- 서버가 검증할 수 없는 로컬/AI 핫싯 매치는 클라이언트가 만든 키를 쓴다 — 이 경우 dedup은
-- "같은 키로 두 번 못 받는다"만 보장할 뿐, 클라이언트가 매번 새 키를 만들어 반복 청구하는 것까지
-- 막지는 못한다 (README 결정 사항 참고).
CREATE TABLE match_rewards_claimed (
  user_id    TEXT NOT NULL REFERENCES users(id),
  match_key  TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, match_key)
);
