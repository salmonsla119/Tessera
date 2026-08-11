/** 헤드리스 자동 대전 CLI — `pnpm --filter @tessera/rules sim -- --games 1000` */
import { runSimulation } from './sim';

function arg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) ? value : fallback;
}

const games = arg('games', 1000);
const seed = arg('seed', 1);

const started = Date.now();
const summary = runSimulation(games, seed);
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

console.log(`\n자동 대전 ${summary.games}판 (seed ${seed}, ${elapsed}s)\n`);
console.log(`  평균 라운드        ${summary.avgRounds.toFixed(1)}`);
console.log(`  최대 라운드        ${summary.maxRounds}`);
console.log(`  선공 승률          ${pct(summary.firstWinRate)}   (목표 45~55%)`);
console.log(`  무승부율           ${pct(summary.drawRate)}`);
console.log(`  서든데스 발동율    ${pct(summary.suddenDeathRate)}`);
console.log(`  강제 종료율        ${pct(summary.timeoutRate)}   (0%이어야 함)`);
console.log(`  AP 몰빵 승리 비율  ${pct(summary.apHogRate)}   (단일 기물 70%+)`);
console.log(`\n  기물별 생존율`);
for (const [baseId, rate] of Object.entries(summary.survivalByBase).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${baseId.padEnd(10)} ${pct(rate)}`);
}
console.log('');
