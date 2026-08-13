import { GACHA_PULL_COST, MATCH_REWARD_CURRENCY, STARTER_BASE_IDS, STARTER_CURRENCY, STARTER_SKILL_IDS } from '@tessera/data';
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

function sessionCookie(res: Response): string {
  const raw = res.headers.get('set-cookie');
  if (!raw) throw new Error('no set-cookie header');
  return raw.split(';')[0]!;
}

async function signup(username: string): Promise<{ cookie: string; id: string }> {
  const res = await SELF.fetch('http://server/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ username, password: 'password123' }),
  });
  expect(res.status).toBe(201);
  const body = await res.json<{ id: string }>();
  return { cookie: sessionCookie(res), id: body.id };
}

async function createDeck(cookie: string, name: string, pieces: { baseId: string; skillId: string }[]) {
  const res = await SELF.fetch('http://server/decks', {
    method: 'POST',
    headers: { cookie },
    body: JSON.stringify({ name, pieces }),
  });
  expect(res.status).toBe(201);
  return res.json<{ id: string }>();
}

const DECK_A_PIECES = [
  { baseId: 'guard', skillId: 'cleave' },
  { baseId: 'lancer', skillId: 'bolt' },
];
// 시작 지급 4베이스(guard/lancer/rider/acolyte) + 4스킬(cleave/bolt/heal/barrier)만 쓴다 —
// 새로 가입한 테스트 계정은 가챠로 뽑지 않는 한 이 조합만 보유하고 있다.
const DECK_B_PIECES = [
  { baseId: 'acolyte', skillId: 'heal' },
  { baseId: 'rider', skillId: 'barrier' },
];

describe('auth', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await SELF.fetch('http://server/decks');
    expect(res.status).toBe(401);
  });

  it('signup -> logout -> me fails, login -> me works', async () => {
    const { cookie } = await signup('alice');
    const me = await SELF.fetch('http://server/auth/me', { headers: { cookie } });
    expect(me.status).toBe(200);

    await SELF.fetch('http://server/auth/logout', { method: 'POST', headers: { cookie } });
    const meAfter = await SELF.fetch('http://server/auth/me', { headers: { cookie } });
    expect(meAfter.status).toBe(401);

    const loginRes = await SELF.fetch('http://server/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'alice', password: 'password123' }),
    });
    expect(loginRes.status).toBe(200);
  });

  it('rejects duplicate usernames', async () => {
    await signup('duplicate_user');
    const res = await SELF.fetch('http://server/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ username: 'duplicate_user', password: 'password123' }),
    });
    expect(res.status).toBe(409);
  });
});

describe('decks', () => {
  it('rejects a deck over budget', async () => {
    const { cookie } = await signup('overbudget');
    const res = await SELF.fetch('http://server/decks', {
      method: 'POST',
      headers: { cookie },
      body: JSON.stringify({
        name: 'too_much',
        pieces: Array.from({ length: 6 }, () => ({ baseId: 'warlord', skillId: 'smite' })),
      }),
    });
    expect(res.status).toBe(400);
  });

  it('creates and lists a valid deck', async () => {
    const { cookie } = await signup('deckowner');
    const deck = await createDeck(cookie, 'starter', DECK_A_PIECES);

    const list = await SELF.fetch('http://server/decks', { headers: { cookie } });
    const decks = await list.json<{ id: string }[]>();
    expect(decks.some((d: { id: string }) => d.id === deck.id)).toBe(true);
  });
});

describe('queue + match flow', () => {
  it('pairs two waiting players and masks state until both deploy', async () => {
    const alice = await signup('queue_alice');
    const bob = await signup('queue_bob');
    const deckA = await createDeck(alice.cookie, 'a', DECK_A_PIECES);
    const deckB = await createDeck(bob.cookie, 'b', DECK_B_PIECES);

    const aliceJoin = await SELF.fetch('http://server/queue', {
      method: 'POST',
      headers: { cookie: alice.cookie },
      body: JSON.stringify({ deckId: deckA.id }),
    });
    expect((await aliceJoin.json<{ status: string }>()).status).toBe('waiting');

    const bobJoin = await SELF.fetch('http://server/queue', {
      method: 'POST',
      headers: { cookie: bob.cookie },
      body: JSON.stringify({ deckId: deckB.id }),
    });
    const bobStatus = await bobJoin.json<{ status: string; matchId?: string }>();
    expect(bobStatus.status).toBe('matched');
    const matchId = bobStatus.matchId!;

    // 재등록은 즉시 매칭 결과를 돌려준다 (§8.4 취소 경합과 대칭인 케이스).
    const aliceStatus = await SELF.fetch('http://server/queue', { headers: { cookie: alice.cookie } });
    expect((await aliceStatus.json<{ status: string; matchId?: string }>()).status).toBe('matched');

    const aliceView = await SELF.fetch(`http://server/matches/${matchId}`, { headers: { cookie: alice.cookie } });
    const aliceState = await aliceView.json<{ role: string; state: { pieces: { owner: string; baseId: string }[] } }>();
    expect(aliceState.role).toBe('A');
    for (const piece of aliceState.state.pieces) {
      if (piece.owner !== aliceState.role) expect(piece.baseId).toBe('');
      else expect(piece.baseId).not.toBe('');
    }

    const placementsFor = (role: 'A' | 'B', pieceIds: string[]) =>
      pieceIds.map((pieceId, i) => ({ pieceId, pos: { x: i, y: role === 'A' ? 0 : 7 } }));

    const deployAlice = await SELF.fetch(`http://server/matches/${matchId}/deploy`, {
      method: 'POST',
      headers: { cookie: alice.cookie },
      body: JSON.stringify({ placements: placementsFor('A', ['A0', 'A1']) }),
    });
    expect(deployAlice.status).toBe(200);

    const deployBob = await SELF.fetch(`http://server/matches/${matchId}/deploy`, {
      method: 'POST',
      headers: { cookie: bob.cookie },
      body: JSON.stringify({ placements: placementsFor('B', ['B0', 'B1']) }),
    });
    const bobDeployBody = await deployBob.json<{ state: { phase: string; pieces: { baseId: string }[] } }>();
    expect(bobDeployBody.state.phase).toBe('battle');
    // 양측 배치가 끝나면 완전정보가 공개된다 (GDD §8.1).
    expect(bobDeployBody.state.pieces.every((p: { baseId: string }) => p.baseId !== '')).toBe(true);
  });

  it('rejects submitting an action as the opponent', async () => {
    const alice = await signup('cheat_alice');
    const bob = await signup('cheat_bob');
    const deckA = await createDeck(alice.cookie, 'a', DECK_A_PIECES);
    const deckB = await createDeck(bob.cookie, 'b', DECK_B_PIECES);

    await SELF.fetch('http://server/queue', {
      method: 'POST',
      headers: { cookie: alice.cookie },
      body: JSON.stringify({ deckId: deckA.id }),
    });
    const bobJoin = await SELF.fetch('http://server/queue', {
      method: 'POST',
      headers: { cookie: bob.cookie },
      body: JSON.stringify({ deckId: deckB.id }),
    });
    const { matchId } = await bobJoin.json<{ matchId: string }>();

    // 아직 배치 단계인데 전투 액션을 제출하면 거부되어야 한다.
    const res = await SELF.fetch(`http://server/matches/${matchId}/actions`, {
      method: 'POST',
      headers: { cookie: alice.cookie },
      body: JSON.stringify({ type: 'endTurn' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects viewing a match you are not part of', async () => {
    const alice = await signup('outsider_alice');
    const bob = await signup('outsider_bob');
    const eve = await signup('outsider_eve');
    const deckA = await createDeck(alice.cookie, 'a', DECK_A_PIECES);
    const deckB = await createDeck(bob.cookie, 'b', DECK_B_PIECES);

    await SELF.fetch('http://server/queue', {
      method: 'POST',
      headers: { cookie: alice.cookie },
      body: JSON.stringify({ deckId: deckA.id }),
    });
    const bobJoin = await SELF.fetch('http://server/queue', {
      method: 'POST',
      headers: { cookie: bob.cookie },
      body: JSON.stringify({ deckId: deckB.id }),
    });
    const { matchId } = await bobJoin.json<{ matchId: string }>();

    const res = await SELF.fetch(`http://server/matches/${matchId}`, { headers: { cookie: eve.cookie } });
    expect(res.status).toBe(403);
  });
});

describe('가챠 / 인벤토리 (신규 시스템)', () => {
  it('계정 생성 시 시작 재화와 시작 지급 4베이스/4스킬을 보유한다', async () => {
    const { cookie } = await signup('gacha_newbie');
    const res = await SELF.fetch('http://server/inventory', { headers: { cookie } });
    expect(res.status).toBe(200);
    const inv = await res.json<{ currency: number; bases: string[]; skills: string[] }>();

    expect(inv.currency).toBe(STARTER_CURRENCY);
    expect([...inv.bases].sort()).toEqual([...STARTER_BASE_IDS].sort());
    expect([...inv.skills].sort()).toEqual([...STARTER_SKILL_IDS].sort());
  });

  it('보유하지 않은 베이스/스킬이 섞인 덱은 거부한다', async () => {
    const { cookie } = await signup('gacha_cheater');
    const res = await SELF.fetch('http://server/decks', {
      method: 'POST',
      headers: { cookie },
      // ranger/rend는 시작 지급 목록에 없다 — 가챠로 뽑지 않는 한 소유할 수 없다.
      body: JSON.stringify({ name: 'unowned', pieces: [{ baseId: 'ranger', skillId: 'rend' }] }),
    });
    expect(res.status).toBe(400);
  });

  it('가챠 1회는 재화를 차감하고 항목을 보유 목록에 추가한다', async () => {
    const { cookie } = await signup('gacha_puller');
    const res = await SELF.fetch('http://server/gacha/pull', { method: 'POST', headers: { cookie } });
    expect(res.status).toBe(200);
    const pull = await res.json<{ item: { itemType: string; itemId: string }; duplicate: boolean; currency: number }>();

    // 시작 지급 항목은 가챠 풀에서 원천 제외되므로 첫 뽑기는 중복일 수 없다.
    expect(pull.duplicate).toBe(false);
    expect(pull.currency).toBe(STARTER_CURRENCY - GACHA_PULL_COST);

    const inv = await (await SELF.fetch('http://server/inventory', { headers: { cookie } })).json<{
      bases: string[];
      skills: string[];
    }>();
    const owned = pull.item.itemType === 'base' ? inv.bases : inv.skills;
    expect(owned).toContain(pull.item.itemId);
  });

  it('재화가 부족하면 가챠 뽑기를 거부한다', async () => {
    const { cookie } = await signup('gacha_broke');
    // 중복 항목은 절반을 환급하므로 잔액이 정확히 0으로 떨어진다는 보장이 없다 —
    // 잔액을 직접 추적하며 더 못 뽑을 때까지 반복한다.
    let currency = STARTER_CURRENCY;
    let guard = 0;
    while (currency >= GACHA_PULL_COST && guard++ < 200) {
      const res = await SELF.fetch('http://server/gacha/pull', { method: 'POST', headers: { cookie } });
      expect(res.status).toBe(200);
      currency = (await res.json<{ currency: number }>()).currency;
    }
    expect(currency).toBeLessThan(GACHA_PULL_COST);

    const overdrawn = await SELF.fetch('http://server/gacha/pull', { method: 'POST', headers: { cookie } });
    expect(overdrawn.status).toBe(400);
  });

  it('로컬/AI 매치 완료 보상은 같은 키로 한 번만 지급된다', async () => {
    const { cookie } = await signup('reward_player');
    const claim = (matchId: string) =>
      SELF.fetch('http://server/rewards/match-complete', {
        method: 'POST',
        headers: { cookie },
        body: JSON.stringify({ mode: 'local', matchId }),
      });

    const first = await claim('local-match-1');
    expect(first.status).toBe(200);
    const firstBody = await first.json<{ granted: boolean; currency: number }>();
    expect(firstBody.granted).toBe(true);
    expect(firstBody.currency).toBe(STARTER_CURRENCY + MATCH_REWARD_CURRENCY);

    const second = await claim('local-match-1');
    const secondBody = await second.json<{ granted: boolean; currency: number }>();
    expect(secondBody.granted).toBe(false);
    expect(secondBody.currency).toBe(STARTER_CURRENCY + MATCH_REWARD_CURRENCY);

    const third = await claim('local-match-2');
    const thirdBody = await third.json<{ granted: boolean; currency: number }>();
    expect(thirdBody.granted).toBe(true);
    expect(thirdBody.currency).toBe(STARTER_CURRENCY + MATCH_REWARD_CURRENCY * 2);
  });

  it('존재하지 않는 온라인 매치의 보상 청구는 거부한다', async () => {
    const { cookie } = await signup('reward_faker');
    const res = await SELF.fetch('http://server/rewards/match-complete', {
      method: 'POST',
      headers: { cookie },
      body: JSON.stringify({ mode: 'online', matchId: 'not-a-real-match' }),
    });
    expect(res.status).toBe(404);
  });
});
