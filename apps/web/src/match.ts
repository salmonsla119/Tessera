import Phaser from 'phaser';
import { requireBase, requireSkill, type Skill } from '@tessera/data';
import {
  chebyshev,
  deployZoneCells,
  isFrozen,
  isSkillLocked,
  movableCells,
  opponentOf,
  previewDamage,
  previewHeal,
  targetableCells,
  terrainAt,
  usableSkills,
  validTargets,
  type Action,
  type Coord,
  type GameEvent,
  type MatchState,
  type PieceState,
  type PlayerId,
} from '@tessera/rules';
import type { Backend, MatchView } from './backend/types';
import { maskState } from './backend/types';
import { BoardScene } from './game/BoardScene';
import { BOARD_PX, baseName, describePassive, skillName, STATUS_LABEL } from './game/theme';
import { api, onlineEnabled } from './online/api';
import { Hud, type HudModel, type LogEntry } from './ui/hud';
import { showModal } from './ui/modal';

async function createBoardScene(parentId: string): Promise<{ game: Phaser.Game; scene: BoardScene }> {
  const scene = new BoardScene();
  const ready = new Promise<void>((resolve) => {
    scene.onReady = resolve;
  });
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: parentId,
    width: BOARD_PX,
    height: BOARD_PX,
    backgroundColor: '#0f1116',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [scene],
  });
  await ready;
  return { game, scene };
}

export interface MatchOptions {
  /**
   * 이 컨트롤러가 항상 대변하는 쪽. 설정하지 않으면 로컬 핫시트 모드로 동작해
   * 배치 순서·턴 교대에 따라 "지금 화면을 보는 사람"이 바뀐다 (기존 동작).
   * 설정하면 그 반대쪽 턴에는 조작이 막히고, 자리 교대 모달도 뜨지 않는다
   * (AI 대전·온라인 대전 모두 이 모드를 쓴다).
   */
  fixedViewer?: PlayerId;
  /**
   * fixedViewer의 반대쪽을 대신 조작하는 함수. 설정하면 그쪽 턴이 됐을 때
   * 애니메이션 페이싱을 두고 자동으로 액션을 제출한다 (AI 대전 전용).
   * 온라인 대전에서는 반대쪽이 실제 사람이므로 설정하지 않는다.
   */
  autoPlayer?: (state: MatchState, role: PlayerId) => Action;
  /**
   * 설정하면 이 간격(ms)으로 backend.getMatch를 불러 상대의 원격 진행을 반영한다
   * (온라인 대전 전용 — 상대의 수는 이벤트가 아니라 폴링으로만 알 수 있다).
   */
  pollMs?: number;
}

/**
 * 한 판의 진행을 맡는 컨트롤러.
 *
 * 규칙 판정은 전혀 하지 않는다 — 백엔드에 액션을 제출하고, 돌려받은 상태와 이벤트를
 * 보드/HUD에 나눠 준다. 백엔드와 MatchOptions를 바꿔 끼우면 로컬 핫시트·AI 대전·
 * 온라인 대전을 모두 이 클래스 하나로 돌린다.
 */
export class MatchController {
  private game!: Phaser.Game;
  private scene!: BoardScene;
  private hud!: Hud;

  private matchId!: string;
  private state!: MatchState;

  /** 배치 단계에서 아직 제출하지 않은 임시 배치. */
  private placements = new Map<string, Coord>();
  /** 배치 단계에서 목록/보드 클릭으로 "손에 든" 기물 — 다음 보드 클릭이 이 기물을 놓는다. */
  private deploySelectedId: string | null = null;
  private selectedId: string | null = null;
  /** 마지막으로 클릭해 정보를 확인한 기물 — 아군·적군 상관없이 바뀐다. */
  private inspectId: string | null = null;
  /** 빈 칸을 클릭했을 때 그 칸의 지형을 보여준다 (표시 개선 — 기물을 클릭하면 비운다). */
  private inspectedTerrainCell: Coord | null = null;
  private activeSkillId: string | null = null;
  /** 예상 데미지를 먼저 보여 주고, 같은 대상을 한 번 더 눌러야 확정된다 (GDD §3.1). */
  private pendingTargetId: string | null = null;
  private log: LogEntry[] = [];
  private busy = false;
  private destroyed = false;
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  /** 턴 시작 시 받은 행동 횟수. TurnStarted 이벤트에서만 갱신한다. */
  private apMax: Record<PlayerId, number> = { A: 0, B: 0 };

  private readonly fixedViewer?: PlayerId;
  private readonly autoPlayer?: (state: MatchState, role: PlayerId) => Action;
  private readonly pollMs?: number;

  constructor(
    private readonly backend: Backend,
    private readonly boardEl: HTMLElement,
    private readonly hudEl: HTMLElement,
    private readonly onExit: () => void,
    options: MatchOptions = {},
  ) {
    this.fixedViewer = options.fixedViewer;
    this.autoPlayer = options.autoPlayer;
    this.pollMs = options.pollMs;
  }

  async start(view: MatchView): Promise<void> {
    this.matchId = view.matchId;
    this.state = view.state;

    const created = await createBoardScene(this.boardEl.id);
    this.game = created.game;
    this.scene = created.scene;
    this.scene.onCellClick = (cell) => void this.handleCellClick(cell);
    this.scene.onPieceDrop = (pieceId, cell) => this.handleDeployDrop(pieceId, cell);

    this.hud = new Hud(this.hudEl, {
      onSelectSkill: (id) => this.selectSkill(id),
      onFocus: () => void this.submit({ type: 'focus', player: this.viewer, pieceId: this.selectedId! }),
      onEndTurn: () => void this.submit({ type: 'endTurn', player: this.viewer }),
      onSubmitDeploy: () => void this.submitDeploy(),
      onSelectDeployPiece: (pieceId) => this.selectDeployPiece(pieceId),
      onExit: () => void this.confirmExit(),
    });

    this.pushLog(`매치 시작 — 선공은 플레이어 ${this.state.first}`, undefined, true);

    if (this.state.phase === 'deploying' && !this.fixedViewer) {
      await showModal({
        title: `플레이어 ${this.viewer} 배치`,
        body: '상대에게 화면이 보이지 않게 한 뒤 진행하세요.',
        actions: [{ label: '시작', value: 'ok', primary: true }],
      });
    }

    if (this.state.phase === 'deploying') this.initDeploySelection();
    this.refresh();
    await this.runAutoTurnsIfNeeded();

    if (this.pollMs && this.fixedViewer) {
      this.pollHandle = setInterval(() => void this.pollRemote(), this.pollMs);
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.pollHandle) clearInterval(this.pollHandle);
    this.game?.destroy(true);
    this.hud?.destroy();
    this.boardEl.replaceChildren();
  }

  /** 지금 화면을 보고 있는 플레이어. 배치 중에는 아직 제출하지 않은 쪽. */
  private get viewer(): PlayerId {
    if (this.fixedViewer) return this.fixedViewer;
    if (this.state.phase === 'deploying') {
      return this.state.deployedPlayers.includes('A') ? 'B' : 'A';
    }
    return this.state.turnOwner;
  }

  private get selected(): PieceState | null {
    return this.state.pieces.find((p) => p.id === this.selectedId) ?? null;
  }

  /** 정보 카드에 보여 줄 기물. 명시적으로 확인한 게 없으면 내가 조작/배치 중인 기물로 되돌아간다. */
  private get viewed(): PieceState | null {
    if (this.inspectId) {
      const found = this.state.pieces.find((p) => p.id === this.inspectId);
      if (found) return found;
    }
    if (this.state.phase === 'deploying') {
      return this.state.pieces.find((p) => p.id === this.deploySelectedId) ?? null;
    }
    return this.selected;
  }

  // ---------- 배치 ----------

  private ownPieces(player: PlayerId): PieceState[] {
    return this.state.pieces.filter((p) => p.owner === player);
  }

  private nextUnplaced(): PieceState | null {
    return this.ownPieces(this.viewer).find((p) => !this.placements.has(p.id)) ?? null;
  }

  /** 배치 단계에 들어서거나 자리를 넘겨받을 때 "손에 든" 기물을 첫 미배치 기물로 되돌린다. */
  private initDeploySelection(): void {
    this.deploySelectedId = this.nextUnplaced()?.id ?? null;
    this.inspectId = this.deploySelectedId;
  }

  /** 목록 또는 보드에서 기물을 골라 "손에 든" 상태로 만들고 정보 카드에 띄운다. */
  private selectDeployPiece(pieceId: string): void {
    this.deploySelectedId = pieceId;
    this.inspectId = pieceId;
    this.refresh();
  }

  /** 임시 배치를 반영한 표시용 상태. 실제 상태는 제출 전까지 바뀌지 않는다. */
  private deployPreviewState(): MatchState {
    const masked = maskState(this.state, this.viewer);
    return {
      ...masked,
      pieces: masked.pieces.map((piece) => {
        if (piece.owner !== this.viewer) return piece;
        return { ...piece, pos: this.placements.get(piece.id) ?? null };
      }),
    };
  }

  /**
   * 파란 구역 클릭 — 그 칸에 이미 다른 기물이 있으면 그 기물을 "손에 들고"(선택) 정보를 보여 주고,
   * 비어 있으면 지금 손에 든 기물을 그 칸에 놓는다. 미배치 기물을 처음 놓을 때만 다음 미배치
   * 기물로 자동으로 넘어간다 — 이미 놓인 기물을 옮기는 중이면 계속 그 기물을 손에 쥔 채로 둔다.
   */
  private handleDeployClick(cell: Coord): void {
    const zone = deployZoneCells(this.viewer);
    if (!zone.some((c) => c.x === cell.x && c.y === cell.y)) return;

    const occupant = [...this.placements.entries()].find(([, pos]) => pos.x === cell.x && pos.y === cell.y);
    if (occupant) {
      this.selectDeployPiece(occupant[0]);
      return;
    }

    if (!this.deploySelectedId) return;
    const wasUnplaced = !this.placements.has(this.deploySelectedId);
    this.placements.set(this.deploySelectedId, cell);
    if (wasUnplaced) this.deploySelectedId = this.nextUnplaced()?.id ?? null;
    this.inspectId = this.deploySelectedId ?? this.inspectId;
    this.refresh();
  }

  /** 보드 위에서 기물을 드래그해 놓았을 때 — 유효하지 않으면 자리를 바꾸지 않고 되돌린다. */
  private handleDeployDrop(pieceId: string, cell: Coord | null): void {
    if (cell) {
      const zone = deployZoneCells(this.viewer);
      const inZone = zone.some((c) => c.x === cell.x && c.y === cell.y);
      const occupiedByOther = [...this.placements.entries()].some(
        ([id, pos]) => id !== pieceId && pos.x === cell.x && pos.y === cell.y,
      );
      if (inZone && !occupiedByOther) {
        this.placements.set(pieceId, cell);
        this.deploySelectedId = pieceId;
        this.inspectId = pieceId;
      }
    }
    this.refresh();
  }

  private async submitDeploy(): Promise<void> {
    const player = this.viewer;
    const action: Action = {
      type: 'deploy',
      player,
      placements: [...this.placements].map(([pieceId, pos]) => ({ pieceId, pos })),
    };

    const view = await this.backend.submitAction(this.matchId, action);
    this.ingestEvents(view.events, this.state);
    this.state = view.state;
    this.placements.clear();
    this.deploySelectedId = null;
    this.inspectId = null;

    if (this.state.phase === 'deploying') {
      this.initDeploySelection();
      if (this.fixedViewer) {
        // 고정 시점(AI·온라인)에서는 자리 교대가 없다 — 상대가 배치를 마칠 때까지 기다린다.
        this.pushLog('상대 배치를 기다리는 중입니다', undefined, true);
      } else {
        await showModal({
          title: `플레이어 ${this.viewer}에게 넘기세요`,
          body: '상대 배치는 아직 공개되지 않습니다.',
          actions: [{ label: '확인', value: 'ok', primary: true }],
        });
      }
    } else {
      await showModal({
        title: '배치 공개',
        body: `양측 덱과 배치가 공개됩니다. 선공은 플레이어 ${this.state.first}입니다.`,
        actions: [{ label: '전투 시작', value: 'ok', primary: true }],
      });
    }

    this.refresh();
    await this.runAutoTurnsIfNeeded();
  }

  // ---------- 전투 ----------

  private selectSkill(skillId: string): void {
    this.activeSkillId = skillId;
    this.pendingTargetId = null;
    this.refresh();
  }

  private defaultSkillFor(piece: PieceState): string {
    const usable = usableSkills(piece);
    return (usable.length > 1 ? usable[1]! : usable[0]!).id;
  }

  private async handleCellClick(cell: Coord): Promise<void> {
    if (this.busy || this.state.phase === 'finished') return;

    if (this.state.phase === 'deploying') {
      // 고정 시점에서는 내가 이미 제출했으면 더 놓을 게 없다 (상대 자리를 빌려 조작하지 않는다).
      if (this.fixedViewer && this.state.deployedPlayers.includes(this.fixedViewer)) return;
      this.handleDeployClick(cell);
      return;
    }

    const occupant = this.state.pieces.find(
      (p) => p.alive && p.pos !== null && p.pos.x === cell.x && p.pos.y === cell.y,
    );

    // 정보 확인은 언제든 할 수 있다 — 상대 턴이어도, 아직 공격 대상을 정하지 않았어도 볼 수 있다.
    // 빈 칸을 클릭하면 기물 정보 대신 그 칸의 지형 이름·효과를 보여준다 (표시 개선).
    if (occupant) {
      this.inspectId = occupant.id;
      this.inspectedTerrainCell = null;
    } else {
      this.inspectedTerrainCell = cell;
    }

    // 고정 시점 모드에서는 상대 턴에 내 화면으로 실제 행동을 넣는 것만 막는다 — 서버도 거부하지만
    // 여기서 막아야 "왜 안 되지" 왕복이 안 생긴다. 정보 카드는 위에서 이미 갱신했으니 그대로 보여 준다.
    if (this.fixedViewer && this.state.turnOwner !== this.fixedViewer) {
      this.refresh();
      return;
    }

    const attacker = this.selected;
    const activeSkill = this.activeSkillId ? requireSkill(this.activeSkillId) : null;
    // 치유·방어 스킬이 활성화된 동안에는 아군(자신 포함) 클릭이 "다른 기물 선택"이 아니라
    // "이 아군을 대상으로" 로 해석된다 — 사거리 밖의 아군은 그대로 선택 가능하다.
    const isAllyTargetSkill = activeSkill?.kind === 'heal' || activeSkill?.kind === 'defense';
    const isAllyTarget =
      Boolean(occupant) &&
      attacker !== null &&
      isAllyTargetSkill &&
      validTargets(this.state, attacker, activeSkill).some((t) => t.id === occupant!.id);

    if (occupant && occupant.owner === this.viewer && !isAllyTarget) {
      this.selectedId = occupant.id;
      this.activeSkillId = this.defaultSkillFor(occupant);
      this.pendingTargetId = null;
      this.refresh();
      return;
    }

    if (!attacker) {
      this.refresh();
      return;
    }

    if (occupant && activeSkill) {
      const inRange = validTargets(this.state, attacker, activeSkill).some((t) => t.id === occupant.id);
      if (!inRange) {
        this.refresh();
        return;
      }

      // 첫 클릭은 예상 결과(데미지/회복량) 표시, 같은 대상 두 번째 클릭이 확정.
      if (this.pendingTargetId !== occupant.id) {
        this.pendingTargetId = occupant.id;
        this.refresh();
        return;
      }

      await this.submit({
        type: 'attack',
        player: this.viewer,
        pieceId: attacker.id,
        skillId: activeSkill.id,
        targetId: occupant.id,
      });
      return;
    }

    if (!occupant && movableCells(this.state, attacker).some((c) => c.x === cell.x && c.y === cell.y)) {
      await this.submit({ type: 'move', player: this.viewer, pieceId: attacker.id, to: cell });
      return;
    }

    this.refresh();
  }

  private async submit(action: Action): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const previousTurnOwner = this.state.turnOwner;
      const view = await this.backend.submitAction(this.matchId, action);
      const nextState = view.state;

      this.ingestEvents(view.events, this.state);

      this.pendingTargetId = null;
      await this.scene.playEvents(view.events, nextState);
      this.state = nextState;

      if (this.state.phase === 'finished') {
        this.selectedId = null;
        this.inspectId = null;
        this.inspectedTerrainCell = null;
        this.refresh();
        await this.showResult();
        return;
      }

      if (this.state.turnOwner !== previousTurnOwner) {
        this.selectedId = null;
        this.activeSkillId = null;
        this.inspectId = null;
        this.inspectedTerrainCell = null;
        this.refresh();
        if (this.fixedViewer) {
          await this.runAutoTurnsIfNeeded();
        } else {
          await showModal({
            title: `플레이어 ${this.state.turnOwner} 차례`,
            body: '화면을 상대에게 넘기고 확인을 누르세요.',
            actions: [{ label: '확인', value: 'ok', primary: true }],
          });
        }
      }

      if (!this.destroyed) this.refresh();
    } catch (error) {
      this.pushLog(error instanceof Error ? error.message : '알 수 없는 오류', undefined, true);
      if (!this.destroyed) this.refresh();
    } finally {
      this.busy = false;
    }
  }

  /**
   * 매치 1판 완료 보상 청구 (신규 시스템 — 가챠). 모드 무관하게 지급하므로 로컬/AI 대전도
   * 포함한다. 서버 계정이 없거나 로그인 상태가 아니면 서버가 401로 거부하는데, 이 UI는 굳이
   * 로그인 여부를 미리 알 필요가 없어 실패를 조용히 무시한다 — 실패해도 게임 진행에는 영향 없음.
   */
  private async claimMatchReward(): Promise<void> {
    if (!onlineEnabled()) return;
    const mode = this.backend.kind === 'remote' ? 'online' : (this.backend.kind as 'local' | 'ai');
    await api.claimMatchReward(mode, this.matchId).catch(() => undefined);
  }

  private async showResult(): Promise<void> {
    void this.claimMatchReward();
    const winner = this.state.winner;
    const title =
      winner === 'draw'
        ? '무승부'
        : this.fixedViewer
          ? winner === this.fixedViewer
            ? '승리했습니다'
            : '패배했습니다'
          : `플레이어 ${winner} 승리`;
    await showModal({
      title,
      body: `${this.state.round}라운드 만에 종료되었습니다.`,
      actions: [{ label: '메뉴로', value: 'ok', primary: true }],
    });
    await this.backend.abandonMatch(this.matchId);
    this.onExit();
  }

  private async confirmExit(): Promise<void> {
    const answer = await showModal({
      title: '매치를 나갑니다',
      body: '진행 상황은 저장되며 메뉴에서 이어할 수 있습니다.',
      actions: [
        { label: '취소', value: 'cancel' },
        { label: '나가기', value: 'exit', primary: true },
      ],
    });
    if (answer === 'exit') this.onExit();
  }

  // ---------- 렌더 ----------

  private pushLog(text: string, owner?: PlayerId, highlight = false): void {
    this.log.push({ text, owner, highlight });
  }

  /** 이벤트에서 기록과 파생 표시값을 뽑아낸다 — 상태를 다시 계산하지 않는다. */
  private ingestEvents(events: readonly GameEvent[], before: MatchState): void {
    for (const event of events) {
      if (event.type === 'TurnStarted') this.apMax[event.player] = event.ap;
    }
    this.log.push(...describeEvents(events, before));
  }

  private refresh(): void {
    if (this.destroyed) return;
    const deploying = this.state.phase === 'deploying';
    const viewState = deploying ? this.deployPreviewState() : this.state;
    // 배치 단계에서는 이미 놓은 내 기물 전부를 드래그로 재배치할 수 있게 한다.
    const draggableIds = deploying ? new Set(this.placements.keys()) : undefined;

    this.scene.sync(viewState, this.viewer, draggableIds);
    this.scene.setHighlights(this.computeHighlights(viewState));
    this.hud.render(this.buildHudModel());
  }

  // ---------- AI 자동 진행 / 온라인 폴링 ----------

  /**
   * fixedViewer의 반대쪽 턴이 되면 autoPlayer로 대신 진행한다 (AI 대전).
   * autoPlayer가 없으면(온라인 대전) 아무것도 하지 않는다 — 상대는 자기 브라우저에서 직접 둔다.
   */
  private async runAutoTurnsIfNeeded(): Promise<void> {
    if (!this.autoPlayer || !this.fixedViewer || this.destroyed) return;
    const aiRole = opponentOf(this.fixedViewer);
    const alreadyBusy = this.busy;
    if (!alreadyBusy) this.busy = true;

    try {
      if (this.state.phase === 'deploying' && !this.state.deployedPlayers.includes(aiRole)) {
        const action = this.autoPlayer(this.state, aiRole);
        const view = await this.backend.submitAction(this.matchId, action);
        this.state = view.state;
        if (!this.destroyed) this.refresh();
      }

      while (!this.destroyed && this.state.phase === 'battle' && this.state.turnOwner === aiRole) {
        await sleep(350);
        if (this.destroyed) return;
        const action = this.autoPlayer(this.state, aiRole);
        const view = await this.backend.submitAction(this.matchId, action);
        this.ingestEvents(view.events, this.state);
        await this.scene.playEvents(view.events, view.state);
        this.state = view.state;
        if (!this.destroyed) this.refresh();
      }

      if (!this.destroyed && this.state.phase === 'finished') {
        await this.showResult();
      }
    } catch (error) {
      if (!this.destroyed) {
        this.pushLog(error instanceof Error ? error.message : 'AI 진행 중 오류', undefined, true);
        this.refresh();
      }
    } finally {
      if (!alreadyBusy) this.busy = false;
    }
  }

  /**
   * 온라인 대전 전용 — 상대의 수는 이벤트로 오지 않으므로 주기적으로 최신 상태를 불러온다.
   * 애니메이션 없이 즉시 반영한다 (지나간 상대 수를 뒤늦게 재생하지 않는다).
   */
  private async pollRemote(): Promise<void> {
    if (this.busy || this.destroyed) return;
    const view = await this.backend.getMatch(this.matchId).catch(() => null);
    if (!view || this.destroyed) return;

    const phaseChanged = view.state.phase !== this.state.phase;
    const turnChanged = view.state.turn !== this.state.turn;
    if (!phaseChanged && !turnChanged) return;

    this.state = view.state;
    this.selectedId = null;
    this.inspectId = null;
    this.inspectedTerrainCell = null;
    this.activeSkillId = null;
    this.pendingTargetId = null;
    if (phaseChanged && view.state.phase === 'battle') this.pushLog('전투가 시작되었습니다', undefined, true);
    if (turnChanged) this.pushLog('상대가 행동했습니다 — 갱신됨', undefined, true);
    this.refresh();

    if (this.state.phase === 'finished') {
      if (this.pollHandle) clearInterval(this.pollHandle);
      await this.showResult();
    }
  }

  private computeHighlights(viewState: MatchState) {
    if (this.state.phase === 'deploying') {
      const selectedCoord = this.deploySelectedId ? (this.placements.get(this.deploySelectedId) ?? null) : null;
      return { deploy: deployZoneCells(this.viewer), selected: selectedCoord };
    }

    const piece = this.selected;
    if (!piece || !piece.alive || piece.pos === null || this.state.turnOwner !== this.viewer || isFrozen(piece)) {
      // 조작 중인 기물이 없을 때는 지형을 확인하려고 클릭한 칸을 옅게 표시해 준다 (표시 개선).
      return { selected: this.inspectedTerrainCell };
    }

    // 사거리 형태 전체를 보여준다 — 지금 그 칸에 대상이 있는지와 무관하게, 스킬이 닿는 범위 자체를 보여준다.
    // damage 스킬은 빨간 칸, heal은 초록 칸, defense는 파란 칸으로 구분한다 (신규 시스템).
    const skill = this.activeSkillId ? requireSkill(this.activeSkillId) : null;
    const cells = skill ? targetableCells(viewState, piece.pos, skill) : [];

    return {
      move: this.state.ap[this.viewer] > 0 ? movableCells(viewState, piece) : [],
      attack: skill?.kind === 'damage' ? cells : [],
      heal: skill?.kind === 'heal' ? cells : [],
      defense: skill?.kind === 'defense' ? cells : [],
      selected: piece.pos,
    };
  }

  private buildHudModel(): HudModel {
    const actingPiece = this.selected;
    const viewedPiece = this.viewed;
    const viewer = this.viewer;
    const skills: Skill[] = actingPiece ? usableSkills(actingPiece) : [];
    const locked = actingPiece && isSkillLocked(actingPiece) ? requireSkill(actingPiece.skillId) : null;

    let preview: HudModel['preview'] = null;
    if (actingPiece && actingPiece.pos && this.pendingTargetId && this.activeSkillId) {
      const target = this.state.pieces.find((p) => p.id === this.pendingTargetId);
      const skill = requireSkill(this.activeSkillId);
      if (target?.pos) {
        const distance = chebyshev(actingPiece.pos, target.pos);
        preview = {
          targetName: `${baseName(target.baseId)}(${skillName(target.skillId)})`,
          distance,
          kind: skill.kind,
          range:
            skill.kind === 'heal' || skill.kind === 'defense'
              ? previewHeal(skill)
              : previewDamage(this.state, actingPiece, skill, distance),
        };
      }
    }

    const placed = this.placements.size;
    const deployRoster: HudModel['deployRoster'] =
      this.state.phase === 'deploying'
        ? this.ownPieces(viewer).map((p) => ({
            id: p.id,
            label: `${baseName(p.baseId)} · ${skillName(p.skillId)}`,
            placed: this.placements.has(p.id),
            selected: p.id === this.deploySelectedId,
          }))
        : [];

    return {
      phase: this.state.phase,
      viewer,
      round: this.state.round,
      ap: this.state.ap[viewer],
      apMax: this.apMaxFor(viewer),
      carryTenths: this.state.apPoolTenths[viewer],
      teamSpeed: this.state.teamSpeed[viewer],
      aliveA: this.state.pieces.filter((p) => p.owner === 'A' && p.alive).length,
      aliveB: this.state.pieces.filter((p) => p.owner === 'B' && p.alive).length,
      suddenDeath: this.state.suddenDeath,
      selected: viewedPiece,
      isMine: viewedPiece !== null && viewedPiece.owner === viewer,
      selectedTerrain: viewedPiece?.pos ? terrainAt(this.state, viewedPiece.pos) : null,
      selectedPassiveText: viewedPiece ? passiveTextFor(viewedPiece) : null,
      inspectedTerrain:
        !viewedPiece && this.inspectedTerrainCell ? terrainAt(this.state, this.inspectedTerrainCell) : null,
      activeSkillId: this.activeSkillId,
      usableSkills: skills,
      lockedSkill: locked,
      canFocus: Boolean(
        actingPiece &&
          viewedPiece?.id === actingPiece.id &&
          this.state.phase === 'battle' &&
          this.state.turnOwner === viewer &&
          this.state.ap[viewer] > 0 &&
          actingPiece.sp < actingPiece.maxSp,
      ),
      deployRemaining: this.ownPieces(viewer).length - placed,
      deployRoster,
      preview,
      log: this.log,
    };
  }

  private apMaxFor(player: PlayerId): number {
    return this.apMax[player];
  }
}

/** 이벤트를 사람이 읽는 한 줄짜리 기록으로 바꾼다. */
function describeEvents(events: readonly GameEvent[], before: MatchState): LogEntry[] {
  const nameOf = (id: string) => {
    const piece = before.pieces.find((p) => p.id === id);
    return piece ? `${piece.owner}·${baseName(piece.baseId)}` : id;
  };
  const ownerOf = (id: string) => before.pieces.find((p) => p.id === id)?.owner;

  const entries: LogEntry[] = [];
  for (const event of events) {
    switch (event.type) {
      case 'Deployed':
        entries.push({ text: `플레이어 ${event.player} 배치 완료`, owner: event.player });
        break;
      case 'BattleStarted':
        entries.push({ text: '배치 공개 — 전투 시작', highlight: true });
        break;
      case 'PieceMoved':
        entries.push({ text: `${nameOf(event.pieceId)} 이동`, owner: ownerOf(event.pieceId) });
        break;
      case 'SkillUsed':
        entries.push({
          text: `${nameOf(event.pieceId)} → ${nameOf(event.targetId)} · ${skillName(event.skillId)} (거리 ${event.distance}, 예상 ${event.preview.min}~${event.preview.max})`,
          owner: ownerOf(event.pieceId),
        });
        break;
      case 'Evaded':
        entries.push({ text: `${nameOf(event.pieceId)} 회피 성공`, owner: ownerOf(event.pieceId) });
        break;
      case 'Damaged':
        entries.push({
          text: `${nameOf(event.pieceId)} HP −${event.amount} (${event.hp} 남음)`,
          owner: ownerOf(event.pieceId),
        });
        break;
      case 'Healed':
        if (event.amount > 0) {
          entries.push({
            text: `${nameOf(event.pieceId)} HP +${event.amount} (${event.hp} 남음)`,
            owner: ownerOf(event.pieceId),
          });
        }
        break;
      case 'Focused':
        entries.push({ text: `${nameOf(event.pieceId)} 집중 · SP ${event.sp}`, owner: ownerOf(event.pieceId) });
        break;
      case 'SpDrained':
        entries.push({ text: `${nameOf(event.pieceId)} SP −${event.amount}`, owner: ownerOf(event.pieceId) });
        break;
      case 'StatusApplied': {
        const suffix = event.kind === 'freeze' ? '' : event.kind === 'evaUp' ? ` +${event.value}` : ` −${event.value}`;
        entries.push({
          text: `${nameOf(event.pieceId)} ${STATUS_LABEL[event.kind]}${suffix} (${event.turns}턴)`,
          owner: ownerOf(event.pieceId),
        });
        break;
      }
      case 'PieceDown':
        entries.push({ text: `${nameOf(event.pieceId)} 전사`, owner: ownerOf(event.pieceId), highlight: true });
        break;
      case 'SuddenDeath':
        entries.push({ text: `서든데스 — 전 기물 HP −${event.damage}`, highlight: true });
        break;
      case 'TurnStarted':
        entries.push({ text: `── ${event.round}라운드 · 플레이어 ${event.player} (행동 ${event.ap})`, highlight: true });
        break;
      case 'MatchEnded':
        entries.push({ text: event.winner === 'draw' ? '무승부' : `플레이어 ${event.winner} 승리`, highlight: true });
        break;
      default:
        break;
    }
  }
  return entries;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function passiveTextFor(piece: PieceState): string | null {
  const passive = requireBase(piece.baseId).passive;
  return passive ? describePassive(passive) : null;
}
