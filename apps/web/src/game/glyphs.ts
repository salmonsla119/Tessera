import Phaser from 'phaser';

/**
 * 유닛 베이스 문양 (신규 시스템 — 표시 개선). 이미지 에셋 파이프라인이 없어 Phaser Graphics로
 * 그때그때 그린다. 전부 단색(호출자가 넘긴 `color` 하나)만 쓴다 — 진영은 이 색으로 구분한다.
 * 알 수 없는(또는 가려진) 베이스는 물음표 모양의 기본 문양으로 대체한다.
 */
export function drawBaseGlyph(g: Phaser.GameObjects.Graphics, baseId: string, color: number): void {
  g.clear();
  g.fillStyle(color, 1);
  g.lineStyle(2, color, 1);
  (GLYPHS[baseId] ?? drawUnknown)(g);
}

function poly(g: Phaser.GameObjects.Graphics, points: [number, number][], fill = true): void {
  const pts = points.map(([x, y]) => ({ x, y }));
  if (fill) g.fillPoints(pts, true, true);
  else g.strokePoints(pts, true, true);
}

function drawShield(g: Phaser.GameObjects.Graphics): void {
  poly(g, [
    [-7, -8],
    [7, -8],
    [7, 2],
    [0, 9],
    [-7, 2],
  ]);
}

function drawShieldAccent(g: Phaser.GameObjects.Graphics): void {
  drawShield(g);
  g.lineBetween(-7, -1, 7, -1);
  g.fillCircle(0, -3, 2);
}

function drawSpear(g: Phaser.GameObjects.Graphics): void {
  g.lineBetween(-6, 8, 4, -8);
  poly(g, [
    [4, -8],
    [8, -4],
    [1, -4],
  ]);
}

/** 체스 나이트 실루엣을 단순화한 말머리 옆모습. */
function drawHorseHead(g: Phaser.GameObjects.Graphics): void {
  poly(g, [
    [-5, 8],
    [-5, -1],
    [-2, -8],
    [1, -8],
    [-1, -3],
    [4, -5],
    [6, -2],
    [3, 0],
    [3, 8],
  ]);
}

function drawCross(g: Phaser.GameObjects.Graphics): void {
  g.fillRect(-1.5, -8, 3, 16);
  g.fillRect(-6, -1.5, 12, 3);
}

function drawHaloCross(g: Phaser.GameObjects.Graphics): void {
  g.fillRect(-1.3, -7, 2.6, 13);
  g.fillRect(-5, -0.5, 10, 2.6);
  g.strokeCircle(0, -6, 4);
}

function drawBow(g: Phaser.GameObjects.Graphics): void {
  g.beginPath();
  g.arc(-2, 0, 8, -0.9, 0.9, false);
  g.strokePath();
  g.lineBetween(3.1, -6.2, 3.1, 6.2);
  g.lineBetween(-7, 6, 6, -7);
  poly(g, [
    [6, -7],
    [2, -6],
    [5, -3],
  ]);
}

function drawCrown(g: Phaser.GameObjects.Graphics): void {
  g.fillRect(-7, 3, 14, 4);
  poly(g, [
    [-7, 3],
    [-4, -6],
    [-1, 3],
  ]);
  poly(g, [
    [-3, 3],
    [0, -8],
    [3, 3],
  ]);
  poly(g, [
    [1, 3],
    [4, -6],
    [7, 3],
  ]);
}

function eyeLens(g: Phaser.GameObjects.Graphics, rotated: boolean): void {
  const pts: [number, number][] = rotated
    ? [
        [0, -9],
        [4, 0],
        [0, 9],
        [-4, 0],
      ]
    : [
        [-9, 0],
        [0, -5],
        [9, 0],
        [0, 5],
      ];
  poly(g, pts, false);
  g.fillCircle(0, 0, 2.2);
}

function drawEye(g: Phaser.GameObjects.Graphics): void {
  eyeLens(g, false);
}

function drawThirdEye(g: Phaser.GameObjects.Graphics): void {
  eyeLens(g, true);
}

function drawAxe(g: Phaser.GameObjects.Graphics): void {
  g.lineBetween(0, -2, 0, 9);
  poly(g, [
    [0, -8],
    [7, -6],
    [6, -1],
    [0, -2],
  ]);
}

function drawDoubleAxe(g: Phaser.GameObjects.Graphics): void {
  g.lineBetween(0, -6, 0, 6);
  poly(g, [
    [0, -7],
    [7, -6],
    [5, -1],
    [0, -2],
  ]);
  poly(g, [
    [0, -7],
    [-7, -6],
    [-5, -1],
    [0, -2],
  ]);
}

function drawWarhammer(g: Phaser.GameObjects.Graphics): void {
  g.lineBetween(0, -2, 0, 9);
  g.fillRect(-6, -8, 12, 6);
}

function drawDagger(g: Phaser.GameObjects.Graphics): void {
  g.lineBetween(0, -9, 0, 5);
  g.fillRect(-4, -1.5, 8, 2.5);
  g.fillCircle(0, 6, 2);
}

function drawSword(g: Phaser.GameObjects.Graphics): void {
  g.lineBetween(0, -9, 0, 3);
  g.fillRect(-5, -1, 10, 2);
  g.fillRect(-2, 4, 4, 3);
  g.fillRect(-3.5, 6.5, 7, 1.6);
}

function drawTotem(g: Phaser.GameObjects.Graphics): void {
  g.fillRect(-4, 4, 8, 5);
  poly(g, [
    [-5, 4],
    [0, -3],
    [5, 4],
  ]);
  g.fillCircle(0, -6, 3);
}

function drawSnowflake(g: Phaser.GameObjects.Graphics): void {
  for (let i = 0; i < 3; i++) {
    const angle = (i * Math.PI) / 3;
    const x = 8 * Math.cos(angle);
    const y = 8 * Math.sin(angle);
    g.lineBetween(-x, -y, x, y);
    const mx = 4.5 * Math.cos(angle);
    const my = 4.5 * Math.sin(angle);
    const branch = Math.PI / 5;
    g.lineBetween(mx, my, mx + 2.5 * Math.cos(angle + branch), my + 2.5 * Math.sin(angle + branch));
    g.lineBetween(mx, my, mx + 2.5 * Math.cos(angle - branch), my + 2.5 * Math.sin(angle - branch));
  }
}

function drawClaw(g: Phaser.GameObjects.Graphics): void {
  for (const dx of [-4, 0, 4]) {
    g.beginPath();
    g.arc(dx, -10, 9, 0.9, 2.0, false);
    g.strokePath();
  }
}

function drawFlame(g: Phaser.GameObjects.Graphics): void {
  poly(g, [
    [0, -9],
    [4, -2],
    [3, 3],
    [0, 9],
    [-3, 3],
    [-4, -2],
  ]);
}

function drawCrescentBlade(g: Phaser.GameObjects.Graphics): void {
  g.beginPath();
  g.arc(2, 0, 7, Math.PI * 0.55, Math.PI * 1.45, false);
  g.closePath();
  g.fillPath();
  g.lineBetween(-6, 6, 5, -6);
}

function drawUnknown(g: Phaser.GameObjects.Graphics): void {
  g.strokeCircle(0, 0, 8);
  g.fillCircle(0, 3, 1.6);
  g.fillRect(-1.2, -5, 2.4, 5);
}

const GLYPHS: Record<string, (g: Phaser.GameObjects.Graphics) => void> = {
  guard: drawShield,
  lancer: drawSpear,
  rider: drawHorseHead,
  acolyte: drawCross,
  ranger: drawBow,
  warlord: drawCrown,
  mystic: drawEye,
  berserker: drawAxe,
  paladin: drawHaloCross,
  assassin: drawDagger,
  shaman: drawTotem,
  templar: drawSword,
  frostguard: drawSnowflake,
  swampstalker: drawClaw,
  pyromancer: drawFlame,
  aegisguard: drawShieldAccent,
  reaver: drawDoubleAxe,
  warbringer: drawWarhammer,
  oracle: drawThirdEye,
  duskblade: drawCrescentBlade,
};
