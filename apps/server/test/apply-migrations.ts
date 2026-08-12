import { applyD1Migrations, env } from 'cloudflare:test';

// @ts-expect-error -- injected via miniflare bindings in vitest.config.ts
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
