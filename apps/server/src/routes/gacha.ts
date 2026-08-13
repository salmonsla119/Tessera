import { GACHA_DUPLICATE_REFUND, GACHA_PULL_COST, MATCH_REWARD_CURRENCY } from '@tessera/data';
import { Hono } from 'hono';
import { z } from 'zod';
import { newId } from '../auth';
import {
  addCurrency,
  claimMatchReward,
  getCurrency,
  getMatch,
  insertGachaPull,
  isOwned,
  listInventory,
  roleOf,
  trySpendCurrency,
  unlockItem,
} from '../db';
import { rollGachaItem } from '../gacha';
import { requireAuth } from '../middleware';
import type { AuthedVars, Env } from '../types';

const app = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
app.use('*', requireAuth);

app.get('/inventory', async (c) => {
  const userId = c.get('userId');
  const [currency, inventory] = await Promise.all([getCurrency(c.env.DB, userId), listInventory(c.env.DB, userId)]);
  return c.json({
    currency,
    bases: inventory.filter((r) => r.item_type === 'base').map((r) => r.item_id),
    skills: inventory.filter((r) => r.item_type === 'skill').map((r) => r.item_id),
  });
});

app.post('/gacha/pull', async (c) => {
  const userId = c.get('userId');
  const now = Date.now();

  const spent = await trySpendCurrency(c.env.DB, userId, GACHA_PULL_COST, now);
  if (!spent) return c.json({ error: '재화가 부족합니다' }, 400);

  const rolled = rollGachaItem();
  const duplicate = await isOwned(c.env.DB, userId, rolled.itemType, rolled.itemId);

  let refund = 0;
  if (duplicate) {
    refund = GACHA_DUPLICATE_REFUND;
    await addCurrency(c.env.DB, userId, refund, now);
  } else {
    await unlockItem(c.env.DB, userId, rolled.itemType, rolled.itemId, now);
  }

  await insertGachaPull(
    c.env.DB,
    { id: newId(), userId, itemType: rolled.itemType, itemId: rolled.itemId, rarity: rolled.rarity, duplicate, refund },
    now,
  );

  return c.json({ item: rolled, duplicate, refund, currency: await getCurrency(c.env.DB, userId) });
});

const RewardClaimSchema = z.object({
  mode: z.enum(['online', 'local', 'ai']),
  matchId: z.string().min(1).max(64),
});

app.post('/rewards/match-complete', async (c) => {
  const parsed = RewardClaimSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: '입력값이 올바르지 않습니다' }, 400);
  const { mode, matchId } = parsed.data;
  const userId = c.get('userId');

  // 온라인 매치는 실제로 이 유저가 참가했고 끝났는지까지 검증한다. 로컬/AI 핫싯은 서버에
  // 매치 기록이 아예 없어(브라우저에서만 진행) 이 이상의 검증이 불가능하다 — dedup 키만으로
  // 같은 판을 두 번 청구하는 것만 막는다 (README 결정 사항 참고).
  if (mode === 'online') {
    const row = await getMatch(c.env.DB, matchId);
    if (!row) return c.json({ error: '매치를 찾을 수 없습니다' }, 404);
    if (!roleOf(row, userId)) return c.json({ error: '이 매치에 참가하지 않았습니다' }, 403);
    if (row.status !== 'finished') return c.json({ error: '아직 끝나지 않은 매치입니다' }, 400);
  }

  const now = Date.now();
  const matchKey = `${mode}:${matchId}`;
  const granted = await claimMatchReward(c.env.DB, userId, matchKey, now);
  if (granted) await addCurrency(c.env.DB, userId, MATCH_REWARD_CURRENCY, now);

  return c.json({ granted, currency: await getCurrency(c.env.DB, userId) });
});

export default app;
