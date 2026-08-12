import { getCookie } from 'hono/cookie';
import type { Context, Next } from 'hono';
import { getValidSession } from './db';
import type { AuthedVars, Env } from './types';

export const SESSION_COOKIE = 'tessera_session';

export async function requireAuth(c: Context<{ Bindings: Env; Variables: AuthedVars }>, next: Next) {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return c.json({ error: '로그인이 필요합니다' }, 401);

  const session = await getValidSession(c.env.DB, token, Date.now());
  if (!session) return c.json({ error: '세션이 만료되었습니다' }, 401);

  c.set('userId', session.user_id);
  await next();
}
