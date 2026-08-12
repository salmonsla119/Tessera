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
const DECK_B_PIECES = [
  { baseId: 'acolyte', skillId: 'hex' },
  { baseId: 'ranger', skillId: 'rend' },
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
