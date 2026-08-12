import Phaser from 'phaser';
import type { StatusKind } from '@tessera/data';
import type { Coord, GameEvent, MatchState, PieceState, PlayerId } from '@tessera/rules';
import { BOARD_PX, CELL, COLORS, PAD, STATUS_COLOR, TERRAIN_COLORS, ownerColor, pieceLabel, toCell, toPixel } from './theme';

export interface Highlights {
  move?: Coord[];
  attack?: Coord[];
  heal?: Coord[];
  deploy?: Coord[];
  selected?: Coord | null;
}

interface PieceView {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Arc;
  hpFill: Phaser.GameObjects.Rectangle;
  spFill: Phaser.GameObjects.Rectangle;
  statusBadges: Phaser.GameObjects.Arc[];
}

const BODY_RADIUS = 23;
const BAR_WIDTH = 42;

/**
 * 보드 렌더링과 연출만 담당한다.
 *
 * 규칙 판정은 전혀 하지 않는다 — 상태를 그리고, applyAction이 돌려준 이벤트를 재생할 뿐이다
 * (PLAN §3.2). 씬 안에 규칙이 스며들면 서버 검증·리플레이가 전부 깨진다.
 */
export class BoardScene extends Phaser.Scene {
  static readonly KEY = 'board';

  private views = new Map<string, PieceView>();
  private terrainLayer!: Phaser.GameObjects.Graphics;
  private terrainDrawn = false;
  private hintLayer!: Phaser.GameObjects.Graphics;
  private fxLayer!: Phaser.GameObjects.Graphics;
  private lastState: MatchState | null = null;

  /** 컨트롤러가 주입한다. 씬은 클릭 좌표만 넘기고 판단은 하지 않는다. */
  onCellClick: (cell: Coord) => void = () => {};

  /**
   * create()가 끝났음을 알린다.
   * Phaser는 씬을 SceneManager에 등록할 때 비로소 `events`를 붙이므로,
   * 생성자 직후에 `scene.events.once(...)`를 걸 수 없다.
   */
  onReady: (() => void) | null = null;

  constructor() {
    super(BoardScene.KEY);
  }

  // Phaser의 Scene 타입에는 create가 선언돼 있지 않아 override를 붙일 수 없다.
  create(): void {
    this.drawBoard();
    this.terrainLayer = this.add.graphics().setDepth(0.5);
    this.hintLayer = this.add.graphics().setDepth(1);
    this.fxLayer = this.add.graphics().setDepth(30);

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const cell = toCell(pointer.worldX, pointer.worldY);
      if (cell) this.onCellClick(cell);
    });

    this.onReady?.();
  }

  private drawBoard(): void {
    const g = this.add.graphics().setDepth(0);
    g.fillStyle(COLORS.boardEdge, 1);
    g.fillRoundedRect(0, 0, BOARD_PX, BOARD_PX, 10);

    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        g.fillStyle((x + y) % 2 === 0 ? COLORS.boardDark : COLORS.boardLight, 1);
        g.fillRect(PAD + x * CELL, PAD + (7 - y) * CELL, CELL, CELL);
      }
    }

    const style = { fontFamily: 'ui-monospace, monospace', fontSize: '11px', color: '#6f7a90' };
    for (let i = 0; i < 8; i++) {
      const { px, py } = toPixel(i, i);
      this.add.text(px, BOARD_PX - PAD / 2, String.fromCharCode(97 + i), style).setOrigin(0.5).setDepth(1);
      this.add.text(PAD / 2, py, String(i + 1), style).setOrigin(0.5).setDepth(1);
    }
  }

  /** 지형 타일을 색칠한다 — 매치 내내 바뀌지 않으므로 최초 한 번만 그린다 (신규 시스템). */
  private renderTerrain(state: MatchState): void {
    if (this.terrainDrawn) return;
    this.terrainDrawn = true;

    for (const [key, kind] of Object.entries(state.terrain)) {
      const color = TERRAIN_COLORS[kind];
      if (color === undefined) continue;
      const [x, y] = key.split(',').map(Number) as [number, number];
      const { px, py } = toPixel(x, y);
      this.terrainLayer.fillStyle(color, 0.55);
      this.terrainLayer.fillRect(px - CELL / 2, py - CELL / 2, CELL, CELL);
    }
  }

  /** 상태를 화면에 반영한다. 없던 기물은 만들고, 죽은 기물은 치운다. */
  sync(state: MatchState, viewer?: PlayerId): void {
    this.lastState = state;
    this.renderTerrain(state);
    const seen = new Set<string>();

    for (const piece of state.pieces) {
      if (!piece.alive || piece.pos === null) continue;
      seen.add(piece.id);
      const view = this.views.get(piece.id) ?? this.createView(piece);
      this.updateView(view, piece, viewer);
      const { px, py } = toPixel(piece.pos.x, piece.pos.y);
      view.container.setPosition(px, py);
    }

    for (const [id, view] of this.views) {
      if (!seen.has(id)) {
        view.container.destroy();
        this.views.delete(id);
      }
    }
  }

  private createView(piece: PieceState): PieceView {
    const color = ownerColor(piece.owner);
    const body = this.add.circle(0, 0, BODY_RADIUS, 0x151922).setStrokeStyle(2.5, color);
    const label = this.add
      .text(0, -3, pieceLabel(piece.baseId), {
        fontFamily: "'Noto Sans KR', sans-serif",
        fontSize: '19px',
        color: '#e6e9f0',
      })
      .setOrigin(0.5);

    const hpBg = this.add.rectangle(0, BODY_RADIUS + 6, BAR_WIDTH, 5, COLORS.hpBarBg);
    const hpFill = this.add.rectangle(-BAR_WIDTH / 2, BODY_RADIUS + 6, BAR_WIDTH, 5, COLORS.hpBar).setOrigin(0, 0.5);
    const spBg = this.add.rectangle(0, BODY_RADIUS + 12, BAR_WIDTH, 3, COLORS.hpBarBg);
    const spFill = this.add.rectangle(-BAR_WIDTH / 2, BODY_RADIUS + 12, BAR_WIDTH, 3, COLORS.spBar).setOrigin(0, 0.5);

    const container = this.add.container(0, 0, [body, label, hpBg, hpFill, spBg, spFill]).setDepth(10);
    const view: PieceView = { container, body, hpFill, spFill, statusBadges: [] };
    this.views.set(piece.id, view);
    return view;
  }

  private updateView(view: PieceView, piece: PieceState, viewer?: PlayerId): void {
    const hidden = viewer !== undefined && piece.owner !== viewer && piece.baseId === 'hidden';
    view.body.setStrokeStyle(2.5, hidden ? COLORS.hidden : ownerColor(piece.owner));
    view.hpFill.width = BAR_WIDTH * Math.max(0, piece.hp / piece.maxHp);
    view.spFill.width = BAR_WIDTH * (piece.maxSp === 0 ? 0 : Math.max(0, piece.sp / piece.maxSp));
    this.updateStatusBadges(view, piece);
  }

  /** 상태이상마다 몸통 위에 작은 색 점을 하나씩 띄운다 (신규 시스템). */
  private updateStatusBadges(view: PieceView, piece: PieceState): void {
    for (const badge of view.statusBadges) badge.destroy();
    view.statusBadges = piece.statuses.map((status, i) => {
      const x = -BODY_RADIUS + 6 + i * 11;
      const y = -BODY_RADIUS - 8;
      const color = Phaser.Display.Color.HexStringToColor(STATUS_COLOR[status.kind]).color;
      const dot = this.add.circle(x, y, 4, color).setDepth(11);
      view.container.add(dot);
      return dot;
    });
  }

  setHighlights(h: Highlights): void {
    const g = this.hintLayer;
    g.clear();

    for (const cell of h.deploy ?? []) {
      const { px, py } = toPixel(cell.x, cell.y);
      g.fillStyle(COLORS.deployZone, 0.1);
      g.fillRect(px - CELL / 2, py - CELL / 2, CELL, CELL);
    }

    for (const cell of h.move ?? []) {
      const { px, py } = toPixel(cell.x, cell.y);
      g.fillStyle(COLORS.moveHint, 0.16);
      g.fillRect(px - CELL / 2, py - CELL / 2, CELL, CELL);
      g.fillStyle(COLORS.moveHint, 0.65);
      g.fillCircle(px, py, 6);
    }

    for (const cell of h.attack ?? []) {
      const { px, py } = toPixel(cell.x, cell.y);
      g.lineStyle(3, COLORS.attackHint, 0.9);
      g.strokeRect(px - CELL / 2 + 2, py - CELL / 2 + 2, CELL - 4, CELL - 4);
    }

    for (const cell of h.heal ?? []) {
      const { px, py } = toPixel(cell.x, cell.y);
      g.lineStyle(3, COLORS.healHint, 0.9);
      g.strokeRect(px - CELL / 2 + 2, py - CELL / 2 + 2, CELL - 4, CELL - 4);
    }

    if (h.selected) {
      const { px, py } = toPixel(h.selected.x, h.selected.y);
      g.lineStyle(3, COLORS.selected, 1);
      g.strokeRect(px - CELL / 2 + 2, py - CELL / 2 + 2, CELL - 4, CELL - 4);
    }
  }

  /**
   * applyAction이 돌려준 이벤트를 순서대로 재생한다.
   * 상태를 다시 계산하지 않고 이벤트가 들고 온 값만 쓴다.
   */
  async playEvents(events: readonly GameEvent[], finalState: MatchState, viewer?: PlayerId): Promise<void> {
    for (const event of events) {
      switch (event.type) {
        case 'PieceMoved':
          await this.animateMove(event.pieceId, event.to);
          break;
        case 'SkillUsed':
          await this.animateStrike(event.pieceId, event.from, event.to);
          break;
        case 'Evaded':
          await this.animateEvade(event.pieceId);
          break;
        case 'Damaged':
          await this.animateDamage(event.pieceId, event.amount, event.hp);
          break;
        case 'Healed':
          await this.animateHeal(event.pieceId, event.amount, event.hp);
          break;
        case 'Focused':
          await this.floatText(event.pieceId, '집중 +3 SP', '#6ea8fe');
          break;
        case 'SpDrained':
          await this.floatText(event.pieceId, `SP −${event.amount}`, '#6ea8fe');
          break;
        case 'StatusApplied':
          await this.floatText(event.pieceId, statusFloatText(event.kind, event.value), STATUS_COLOR[event.kind]);
          break;
        case 'PieceDown':
          await this.animateDown(event.pieceId);
          break;
        case 'SuddenDeath':
          await this.flashScreen();
          break;
        default:
          break;
      }
    }
    this.sync(finalState, viewer);
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => this.time.delayedCall(ms, resolve));
  }

  private async animateMove(pieceId: string, to: Coord): Promise<void> {
    const view = this.views.get(pieceId);
    if (!view) return;
    const { px, py } = toPixel(to.x, to.y);
    await new Promise<void>((resolve) => {
      this.tweens.add({
        targets: view.container,
        x: px,
        y: py,
        duration: 190,
        ease: 'Cubic.easeOut',
        onComplete: () => resolve(),
      });
    });
  }

  /** 인접 공격은 공격자가 대상 쪽으로 짧게 파고들었다 돌아온다. 원거리는 탄환이 날아간다. */
  private async animateStrike(attackerId: string, from: Coord, to: Coord): Promise<void> {
    const a = toPixel(from.x, from.y);
    const b = toPixel(to.x, to.y);
    const cellDistance = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));

    if (cellDistance <= 1) {
      await this.lunge(attackerId, a, b);
    } else {
      await this.projectile(a, b);
    }
  }

  private async lunge(attackerId: string, a: { px: number; py: number }, b: { px: number; py: number }): Promise<void> {
    const view = this.views.get(attackerId);
    if (!view) {
      await this.slash(a, b);
      return;
    }

    const lungeX = a.px + (b.px - a.px) * 0.32;
    const lungeY = a.py + (b.py - a.py) * 0.32;

    await new Promise<void>((resolve) => {
      this.tweens.add({
        targets: view.container,
        x: lungeX,
        y: lungeY,
        duration: 90,
        ease: 'Quad.easeOut',
        onComplete: () => resolve(),
      });
    });

    this.slash(a, b, 90);

    await new Promise<void>((resolve) => {
      this.tweens.add({
        targets: view.container,
        x: a.px,
        y: a.py,
        duration: 110,
        ease: 'Quad.easeIn',
        onComplete: () => resolve(),
      });
    });
  }

  private async slash(a: { px: number; py: number }, b: { px: number; py: number }, duration = 110): Promise<void> {
    this.fxLayer.clear();
    this.fxLayer.lineStyle(3, 0xffd479, 0.95);
    this.fxLayer.lineBetween(a.px, a.py, b.px, b.py);
    await this.wait(duration);
    this.fxLayer.clear();
  }

  private async projectile(a: { px: number; py: number }, b: { px: number; py: number }): Promise<void> {
    const dist = Phaser.Math.Distance.Between(a.px, a.py, b.px, b.py);
    const duration = Math.min(260, Math.max(120, dist * 0.55));
    const dot = this.add.circle(a.px, a.py, 5, 0xffd479).setDepth(35);

    await new Promise<void>((resolve) => {
      this.tweens.add({
        targets: dot,
        x: b.px,
        y: b.py,
        duration,
        ease: 'Linear',
        onComplete: () => {
          dot.destroy();
          resolve();
        },
      });
    });
  }

  /** 명중 시 대상 위에 색이 있는 충격파를 한 번 퍼뜨린다. 연출용이라 결과를 기다리지 않는다. */
  private spawnRing(x: number, y: number, color: number): void {
    const ring = this.add.circle(x, y, BODY_RADIUS * 0.6, color, 0).setStrokeStyle(3, color, 0.9).setDepth(32);
    this.tweens.add({
      targets: ring,
      radius: BODY_RADIUS + 16,
      alpha: 0,
      duration: 260,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  private async animateDamage(pieceId: string, amount: number, hp: number): Promise<void> {
    const view = this.views.get(pieceId);
    if (!view) return;

    view.hpFill.width = BAR_WIDTH * Math.max(0, hp / Math.max(1, this.maxHpOf(pieceId)));

    this.tweens.add({
      targets: view.container,
      scale: { from: 1.14, to: 1 },
      duration: 180,
      ease: 'Back.easeOut',
    });
    this.spawnRing(view.container.x, view.container.y, 0xff6b6b);
    if (amount >= 6) this.cameras.main.shake(120, 0.004);

    await this.floatText(pieceId, `−${amount}`, '#ff8f8f');
  }

  /** 치유는 초록 링 + 위로 뜨는 "+N" 텍스트로 표현한다 (신규 시스템). */
  private async animateHeal(pieceId: string, amount: number, hp: number): Promise<void> {
    const view = this.views.get(pieceId);
    if (!view) return;

    view.hpFill.width = BAR_WIDTH * Math.max(0, hp / Math.max(1, this.maxHpOf(pieceId)));
    this.spawnRing(view.container.x, view.container.y, 0x4ade80);

    if (amount <= 0) return; // 이미 만피라 회복량이 0이면 굳이 텍스트를 띄우지 않는다.
    await this.floatText(pieceId, `+${amount}`, '#4ade80');
  }

  /** 회피는 살짝 옆으로 비켜섰다 돌아오는 것으로 표현한다. */
  private async animateEvade(pieceId: string): Promise<void> {
    const view = this.views.get(pieceId);
    if (view) {
      const dx = (Math.random() > 0.5 ? 1 : -1) * 10;
      await new Promise<void>((resolve) => {
        this.tweens.add({
          targets: view.container,
          x: view.container.x + dx,
          duration: 70,
          yoyo: true,
          ease: 'Quad.easeOut',
          onComplete: () => resolve(),
        });
      });
    }
    await this.floatText(pieceId, '회피!', '#8d97ab');
  }

  private maxHpOf(pieceId: string): number {
    return this.lastState?.pieces.find((p) => p.id === pieceId)?.maxHp ?? 1;
  }

  private async floatText(pieceId: string, message: string, color: string): Promise<void> {
    const view = this.views.get(pieceId);
    if (!view) return;

    const text = this.add
      .text(view.container.x, view.container.y - 26, message, {
        fontFamily: "'Noto Sans KR', sans-serif",
        fontSize: '16px',
        fontStyle: 'bold',
        color,
      })
      .setOrigin(0.5)
      .setDepth(40);

    await new Promise<void>((resolve) => {
      this.tweens.add({
        targets: text,
        y: text.y - 26,
        alpha: { from: 1, to: 0 },
        duration: 520,
        ease: 'Quad.easeOut',
        onComplete: () => {
          text.destroy();
          resolve();
        },
      });
    });
  }

  private async animateDown(pieceId: string): Promise<void> {
    const view = this.views.get(pieceId);
    if (!view) return;
    await new Promise<void>((resolve) => {
      this.tweens.add({
        targets: view.container,
        alpha: 0,
        scale: 0.4,
        angle: 90,
        duration: 300,
        ease: 'Quad.easeIn',
        onComplete: () => {
          view.container.destroy();
          this.views.delete(pieceId);
          resolve();
        },
      });
    });
  }

  private async flashScreen(): Promise<void> {
    const rect = this.add.rectangle(BOARD_PX / 2, BOARD_PX / 2, BOARD_PX, BOARD_PX, 0xff6b6b, 0.28).setDepth(50);
    await new Promise<void>((resolve) => {
      this.tweens.add({
        targets: rect,
        alpha: 0,
        duration: 420,
        onComplete: () => {
          rect.destroy();
          resolve();
        },
      });
    });
  }
}

function statusFloatText(kind: StatusKind, value: number): string {
  switch (kind) {
    case 'evaDown':
      return `회피 −${value}`;
    case 'burn':
      return '화상!';
    case 'bleed':
      return '출혈!';
    case 'freeze':
      return '빙결!';
    default:
      return '';
  }
}
