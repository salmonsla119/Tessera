import { Hono } from 'hono';
import { z } from 'zod';
import { countActiveMatches, getLastOpponent } from '../db';
import { requireAuth } from '../middleware';
import { requireOwnedDeck } from './decks';
import type { AuthedVars, Env } from '../types';
import type { QueueStatus } from '../durable-objects/match-queue';

const MAX_ACTIVE_MATCHES = 10;

const app = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
app.use('*', requireAuth);

function queueStub(env: Env) {
  const id = env.MATCH_QUEUE.idFromName('global');
  return env.MATCH_QUEUE.get(id);
}

app.post('/', async (c) => {
  const parsed = z.object({ deckId: z.string() }).safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: '덱을 지정해야 합니다' }, 400);

  const userId = c.get('userId');
  const deck = await requireOwnedDeck(c.env.DB, parsed.data.deckId, userId);
  if (!deck) return c.json({ error: '유효한 덱을 찾을 수 없습니다' }, 404);

  const activeCount = await countActiveMatches(c.env.DB, userId);
  if (activeCount >= MAX_ACTIVE_MATCHES) {
    return c.json({ error: `진행 중인 매치가 이미 ${MAX_ACTIVE_MATCHES}개입니다` }, 400);
  }

  const lastOpponentId = await getLastOpponent(c.env.DB, userId);

  const res = await queueStub(c.env).fetch('http://queue/join', {
    method: 'POST',
    body: JSON.stringify({ userId, deckSnapshot: deck, lastOpponentId, now: Date.now() }),
  });
  const status = await res.json<QueueStatus>();
  return c.json(status);
});

app.get('/', async (c) => {
  const res = await queueStub(c.env).fetch(`http://queue/status?userId=${encodeURIComponent(c.get('userId'))}`);
  const status = await res.json<QueueStatus>();
  return c.json(status);
});

app.delete('/', async (c) => {
  const res = await queueStub(c.env).fetch('http://queue/leave', {
    method: 'POST',
    body: JSON.stringify({ userId: c.get('userId') }),
  });
  const status = await res.json<QueueStatus>();
  return c.json(status);
});

export default app;
