import type { Action, PlayerId } from '@tessera/rules';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { newId } from '../auth';
import {
  countActiveMatches,
  createInvite,
  deleteInvite,
  getMatch,
  getUserById,
  getValidInvite,
  insertMatch,
  listActions,
  listMatchesForUser,
  parseMatchState,
  persistAction,
  roleOf,
} from '../db';
import { applyMatchAction, buildMatchRow, IllegalActionError, maskState } from '../match';
import { requireAuth } from '../middleware';
import { requireOwnedDeck } from './decks';
import type { AuthedVars, Env } from '../types';

const MAX_ACTIVE_MATCHES = 10;
const INVITE_TTL_MS = 60 * 60 * 1000;

const app = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
app.use('*', requireAuth);

app.post('/private', async (c) => {
  const parsed = z.object({ deckId: z.string() }).safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: '덱을 지정해야 합니다' }, 400);

  const userId = c.get('userId');
  const deck = await requireOwnedDeck(c.env.DB, parsed.data.deckId, userId);
  if (!deck) return c.json({ error: '유효한 덱을 찾을 수 없습니다' }, 404);

  const code = newId().slice(0, 8);
  await createInvite(c.env.DB, { code, hostId: userId, deckId: parsed.data.deckId }, Date.now(), INVITE_TTL_MS);
  return c.json({ code });
});

app.post('/private/:code/join', async (c) => {
  const parsed = z.object({ deckId: z.string() }).safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: '덱을 지정해야 합니다' }, 400);

  const userId = c.get('userId');
  const code = c.req.param('code');
  const invite = await getValidInvite(c.env.DB, code, Date.now());
  if (!invite) return c.json({ error: '유효하지 않거나 만료된 초대 코드입니다' }, 404);
  if (invite.host_id === userId) return c.json({ error: '자기 자신과는 대전할 수 없습니다' }, 400);

  const hostDeck = await requireOwnedDeck(c.env.DB, invite.deck_id, invite.host_id);
  const joinerDeck = await requireOwnedDeck(c.env.DB, parsed.data.deckId, userId);
  if (!hostDeck || !joinerDeck) return c.json({ error: '유효한 덱을 찾을 수 없습니다' }, 404);

  for (const uid of [invite.host_id, userId]) {
    const active = await countActiveMatches(c.env.DB, uid);
    if (active >= MAX_ACTIVE_MATCHES) return c.json({ error: `진행 중인 매치가 이미 ${MAX_ACTIVE_MATCHES}개인 참가자가 있습니다` }, 400);
  }

  const now = Date.now();
  const matchId = newId();
  const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
  const row = buildMatchRow({
    id: matchId,
    playerA: invite.host_id,
    playerB: userId,
    deckA: hostDeck,
    deckB: joinerDeck,
    seed,
    ranked: false,
    now,
  });
  await insertMatch(c.env.DB, row);
  await deleteInvite(c.env.DB, code);

  return c.json({ matchId }, 201);
});

app.get('/', async (c) => {
  const userId = c.get('userId');
  const rows = await listMatchesForUser(c.env.DB, userId);

  const summaries = await Promise.all(
    rows.map(async (row) => {
      const role = roleOf(row, userId)!;
      const opponentId = role === 'A' ? row.player_b : row.player_a;
      const opponent = await getUserById(c.env.DB, opponentId);
      const state = parseMatchState(row);
      const myTurn =
        state.phase === 'battle'
          ? state.turnOwner === role
          : state.phase === 'deploying' && !state.deployedPlayers.includes(role);

      return {
        id: row.id,
        role,
        opponentUsername: opponent?.username ?? '(알 수 없음)',
        phase: state.phase,
        myTurn,
        winner: state.winner,
        turnDeadline: row.turn_deadline,
        updatedAt: row.updated_at,
      };
    }),
  );

  return c.json(summaries);
});

app.get('/:id', async (c) => {
  const userId = c.get('userId');
  const row = await getMatch(c.env.DB, c.req.param('id')!);
  if (!row) return c.json({ error: '매치를 찾을 수 없습니다' }, 404);
  const role = roleOf(row, userId);
  if (!role) return c.json({ error: '이 매치에 참가하지 않았습니다' }, 403);

  const state = maskState(parseMatchState(row), role);
  const actions = await listActions(c.env.DB, row.id);

  return c.json({
    id: row.id,
    role,
    state,
    turnDeadline: row.turn_deadline,
    actions: actions.map((a) => ({ seq: a.seq, player: a.player, events: JSON.parse(a.events), createdAt: a.created_at })),
  });
});

const PlacementSchema = z.object({ pieceId: z.string(), pos: z.object({ x: z.number().int(), y: z.number().int() }) });
const DeployBodySchema = z.object({ placements: z.array(PlacementSchema) });

app.post('/:id/deploy', async (c) => {
  const parsed = DeployBodySchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: '입력값이 올바르지 않습니다' }, 400);

  return submitAction(c, (role) => ({ type: 'deploy', player: role, placements: parsed.data.placements }));
});

const ActionBodySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), pieceId: z.string(), to: z.object({ x: z.number().int(), y: z.number().int() }) }),
  z.object({ type: z.literal('attack'), pieceId: z.string(), skillId: z.string(), targetId: z.string() }),
  z.object({ type: z.literal('focus'), pieceId: z.string() }),
  z.object({ type: z.literal('endTurn') }),
]);

app.post('/:id/actions', async (c) => {
  const parsed = ActionBodySchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: '입력값이 올바르지 않습니다' }, 400);

  // player는 요청 바디가 아니라 서버가 인증된 역할로 강제한다 — 남의 턴에 제출하는 부정 액션을
  // 원천 차단한다 (PLAN §4.2, §8.5).
  return submitAction(c, (role) => ({ ...parsed.data, player: role }) as Action);
});

async function submitAction(
  c: Context<{ Bindings: Env; Variables: AuthedVars }>,
  buildAction: (role: PlayerId) => Action,
) {
  const userId = c.get('userId');
  const row = await getMatch(c.env.DB, c.req.param('id')!);
  if (!row) return c.json({ error: '매치를 찾을 수 없습니다' }, 404);
  const role = roleOf(row, userId);
  if (!role) return c.json({ error: '이 매치에 참가하지 않았습니다' }, 403);

  const currentState = parseMatchState(row);
  const action = buildAction(role);

  let applied;
  try {
    applied = applyMatchAction(currentState, action, row.turn_deadline, Date.now());
  } catch (err) {
    if (err instanceof IllegalActionError) return c.json({ error: err.message }, 400);
    throw err;
  }

  const now = Date.now();
  await persistAction(c.env.DB, {
    matchId: row.id,
    seq: row.action_count + 1,
    player: role,
    action,
    events: applied.result.events,
    newState: applied.result.state,
    status: applied.status,
    turnDeadline: applied.turnDeadline,
    now,
  });

  return c.json({
    state: maskState(applied.result.state, role),
    events: applied.result.events,
  });
}

export default app;
