import { validateDeck } from '@tessera/data';
import { Hono } from 'hono';
import { z } from 'zod';
import { deleteDeck, getDeck, listDecks, parseDeckPieces, updateDeck, upsertDeck } from '../db';
import { newId } from '../auth';
import { requireAuth } from '../middleware';
import type { AuthedVars, Env } from '../types';

const app = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
app.use('*', requireAuth);

const DeckBodySchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(64),
  pieces: z.array(z.object({ baseId: z.string(), skillId: z.string() })),
});

app.get('/', async (c) => {
  const rows = await listDecks(c.env.DB, c.get('userId'));
  return c.json(rows.map((r) => ({ id: r.id, name: r.name, pieces: parseDeckPieces(r) })));
});

app.post('/', async (c) => {
  const parsed = DeckBodySchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: '입력값이 올바르지 않습니다' }, 400);

  const validation = validateDeck(parsed.data.pieces);
  if (!validation.ok) return c.json({ error: '덱이 유효하지 않습니다', details: validation.errors }, 400);

  // 클라이언트(RemoteBackend)가 새 덱에도 로컬과 같은 방식으로 id를 미리 붙여 보낸다 — 있으면
  // 그대로 쓰고(업서트), 없으면 서버가 새로 발급한다.
  const id = parsed.data.id ?? newId();
  await upsertDeck(c.env.DB, { id, userId: c.get('userId'), name: parsed.data.name, pieces: parsed.data.pieces }, Date.now());
  return c.json({ id, name: parsed.data.name, pieces: parsed.data.pieces }, 201);
});

app.put('/:id', async (c) => {
  const parsed = DeckBodySchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: '입력값이 올바르지 않습니다' }, 400);

  const validation = validateDeck(parsed.data.pieces);
  if (!validation.ok) return c.json({ error: '덱이 유효하지 않습니다', details: validation.errors }, 400);

  const result = await updateDeck(c.env.DB, c.req.param('id'), c.get('userId'), parsed.data, Date.now());
  if (result.meta.changes === 0) return c.json({ error: '덱을 찾을 수 없습니다' }, 404);
  return c.json({ id: c.req.param('id'), ...parsed.data });
});

app.delete('/:id', async (c) => {
  const result = await deleteDeck(c.env.DB, c.req.param('id'), c.get('userId'));
  if (result.meta.changes === 0) return c.json({ error: '덱을 찾을 수 없습니다' }, 404);
  return c.json({ ok: true });
});

export async function requireOwnedDeck(db: D1Database, deckId: string, userId: string) {
  const row = await getDeck(db, deckId, userId);
  if (!row) return null;
  const pieces = parseDeckPieces(row);
  const validation = validateDeck(pieces);
  if (!validation.ok) return null;
  return { name: row.name, pieces };
}

export default app;
