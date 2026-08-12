import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { createSessionToken, hashPassword, newId, SESSION_TTL_MS, verifyPassword } from '../auth';
import { createSession, createUser, deleteSession, getUserByUsername } from '../db';
import { requireAuth, SESSION_COOKIE } from '../middleware';
import type { AuthedVars, Env } from '../types';

const app = new Hono<{ Bindings: Env; Variables: AuthedVars }>();

const CredentialsSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/, '영문/숫자/밑줄만 사용할 수 있습니다'),
  password: z.string().min(8).max(128),
});

function setSessionCookie(c: Context<{ Bindings: Env; Variables: AuthedVars }>, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

app.post('/signup', async (c) => {
  const parsed = CredentialsSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다' }, 400);
  const { username, password } = parsed.data;

  const existing = await getUserByUsername(c.env.DB, username);
  if (existing) return c.json({ error: '이미 사용 중인 아이디입니다' }, 409);

  const now = Date.now();
  const userId = newId();
  await createUser(c.env.DB, { id: userId, username, passwordHash: await hashPassword(password) }, now);

  const token = createSessionToken();
  await createSession(c.env.DB, { token, userId }, now, SESSION_TTL_MS);
  setSessionCookie(c, token);

  return c.json({ id: userId, username }, 201);
});

app.post('/login', async (c) => {
  const parsed = CredentialsSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: '아이디 또는 비밀번호가 올바르지 않습니다' }, 400);
  const { username, password } = parsed.data;

  const user = await getUserByUsername(c.env.DB, username);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ error: '아이디 또는 비밀번호가 올바르지 않습니다' }, 401);
  }

  const now = Date.now();
  const token = createSessionToken();
  await createSession(c.env.DB, { token, userId: user.id }, now, SESSION_TTL_MS);
  setSessionCookie(c, token);

  return c.json({ id: user.id, username: user.username });
});

app.post('/logout', requireAuth, async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  if (token) await deleteSession(c.env.DB, token);
  return c.json({ ok: true });
});

app.get('/me', requireAuth, async (c) => {
  return c.json({ id: c.get('userId') });
});

export default app;
