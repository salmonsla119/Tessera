import { Hono } from 'hono';
import { cors } from 'hono/cors';
import authRoutes from './routes/auth';
import deckRoutes from './routes/decks';
import matchRoutes from './routes/matches';
import queueRoutes from './routes/queue';
import { listMatchesPastDeadline, parseMatchState, persistAction } from './db';
import { opponentOf } from '@tessera/rules';
import type { AuthedVars, Env } from './types';

export { MatchQueue } from './durable-objects/match-queue';

const ALLOWED_ORIGINS = ['https://salmonsla119.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173'];

const app = new Hono<{ Bindings: Env; Variables: AuthedVars }>();

app.use(
  '*',
  cors({
    origin: (origin) => (ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]!),
    credentials: true,
  }),
);

app.get('/health', (c) => c.json({ ok: true }));

app.route('/auth', authRoutes);
app.route('/decks', deckRoutes);
app.route('/queue', queueRoutes);
app.route('/matches', matchRoutes);

export default {
  fetch: app.fetch,

  /**
   * 24시간 턴 제한시간을 넘긴 매치를 기권 처리한다 (GDD §8.4, PLAN §8.4).
   * 배치 단계에서 넘기면 배치를 마친 쪽이 승리하고, 둘 다 못 마쳤으면 무승부로 종료한다.
   */
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    const now = Date.now();
    const overdue = await listMatchesPastDeadline(env.DB, now, 50);

    for (const row of overdue) {
      const state = parseMatchState(row);

      if (state.phase === 'deploying') {
        const deployed = state.deployedPlayers;
        const winner = deployed.length === 1 ? deployed[0]! : null;
        const finished = { ...state, phase: 'finished' as const, winner: winner ?? ('draw' as const) };
        await persistAction(env.DB, {
          matchId: row.id,
          seq: row.action_count + 1,
          player: winner ?? 'A',
          action: { type: 'forfeit', reason: 'deploy_timeout' },
          events: [{ type: 'MatchEnded', winner: finished.winner }],
          newState: finished,
          status: 'finished',
          turnDeadline: null,
          now,
        });
        continue;
      }

      if (state.phase === 'battle') {
        const winner = opponentOf(state.turnOwner);
        const finished = { ...state, phase: 'finished' as const, winner };
        await persistAction(env.DB, {
          matchId: row.id,
          seq: row.action_count + 1,
          player: state.turnOwner,
          action: { type: 'forfeit', reason: 'turn_timeout' },
          events: [{ type: 'MatchEnded', winner }],
          newState: finished,
          status: 'finished',
          turnDeadline: null,
          now,
        });
      }
    }
  },
};
