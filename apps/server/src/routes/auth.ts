import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { createSessionToken, hashPassword, newId, SESSION_TTL_MS, verifyPassword } from '../auth';
import { createSession, createUser, deleteSession, getUserById, getUserByUsername, grantStarterAccount } from '../db';
import { requireAuth, SESSION_COOKIE } from '../middleware';
import type { AuthedVars, Env } from '../types';

const app = new Hono<{ Bindings: Env; Variables: AuthedVars }>();

const CredentialsSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/, '영문/숫자/밑줄만 사용할 수 있습니다'),
  password: z.string().min(8).max(128),
});

// 클라이언트(GitHub Pages)와 서버(Workers)가 서로 다른 사이트라 SameSite=Lax는 쿠키를
// 아예 못 보낸다. None은 Secure를 요구하는데, Chrome은 http://localhost도 신뢰할 수 있는
// origin으로 취급해 로컬 개발에서도 그대로 동작한다.
const SESSION_COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: 'None',
  path: '/',
} as const;

function setSessionCookie(c: Context<{ Bindings: Env; Variables: AuthedVars }>, token: string) {
  setCookie(c, SESSION_COOKIE, token, { ...SESSION_COOKIE_OPTS, maxAge: SESSION_TTL_MS / 1000 });
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
  await grantStarterAccount(c.env.DB, userId, now);

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
  deleteCookie(c, SESSION_COOKIE, SESSION_COOKIE_OPTS);
  if (token) await deleteSession(c.env.DB, token);
  return c.json({ ok: true });
});

app.get('/me', requireAuth, async (c) => {
  const user = await getUserById(c.env.DB, c.get('userId'));
  if (!user) return c.json({ error: '사용자를 찾을 수 없습니다' }, 404);
  return c.json({ id: user.id, username: user.username });
});

export default app;
