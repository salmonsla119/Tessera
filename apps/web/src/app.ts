import { validateDeck } from '@tessera/data';
import type { DeckSnapshot } from '@tessera/rules';
import { AiMatchBackend } from './ai/backend';
import { AI_DECK_PIECES, createAiPlayer, DIFFICULTY_LABEL, type Difficulty } from './ai/policy';
import { LocalBackend } from './backend/local';
import type { Backend, StoredDeck } from './backend/types';
import { MatchController, type MatchOptions } from './match';
import { api, ApiError, onlineEnabled } from './online/api';
import { RemoteBackend } from './online/backend';
import { PRESET_DECKS } from './presets';
import { mount, uid } from './ui/dom';
import { renderAuth } from './ui/auth';
import { renderDeckBuilder, type Ownership } from './ui/deckbuilder';
import { renderGacha } from './ui/gacha';
import { renderLobby } from './ui/lobby';
import { renderMenu } from './ui/menu';
import { showModal } from './ui/modal';

type SaveDeckFn = (deck: StoredDeck) => Promise<void>;

export class App {
  private readonly backend = new LocalBackend();
  private readonly remoteBackend = new RemoteBackend();
  private readonly screens = document.getElementById('screens') as HTMLElement;
  private readonly matchEl = document.getElementById('match') as HTMLElement;
  private readonly boardEl = document.getElementById('board') as HTMLElement;
  private readonly hudEl = document.getElementById('hud') as HTMLElement;
  private match: MatchController | null = null;
  private lobbyPollHandle: ReturnType<typeof setInterval> | null = null;

  async start(): Promise<void> {
    await this.showMenu();
  }

  private setScreen(mode: 'screens' | 'match'): void {
    this.screens.hidden = mode !== 'screens';
    this.matchEl.hidden = mode !== 'match';
  }

  private stopLobbyPoll(): void {
    if (this.lobbyPollHandle) {
      clearInterval(this.lobbyPollHandle);
      this.lobbyPollHandle = null;
    }
  }

  private async showMenu(): Promise<void> {
    this.stopLobbyPoll();
    this.match?.destroy();
    this.match = null;
    this.setScreen('screens');

    const decks = await this.backend.listDecks();
    renderMenu(
      mount(this.screens),
      { decks, resumable: this.backend.resumableMatchId() !== null },
      {
        onNewDeck: () => this.showDeckBuilder({ id: uid('deck'), name: '새 덱', pieces: [] }),
        onEditDeck: (id) => {
          const deck = decks.find((d) => d.id === id);
          if (deck) this.showDeckBuilder(deck);
        },
        onDeleteDeck: (id) => void this.deleteDeck(id),
        onLoadPresets: () => void this.loadPresets(),
        onStart: (a, b) => void this.startMatch(decks, a, b),
        onStartAi: (deckId, difficulty) => void this.startAiMatch(decks, deckId, difficulty),
        onResume: () => void this.resumeMatch(),
        onAbandon: () => void this.abandonMatch(),
        onOnline: () => void this.showOnlineLobby(),
      },
    );
  }

  private showDeckBuilder(
    deck: StoredDeck,
    onSave: SaveDeckFn = (d) => this.saveDeck(d),
    onCancel: () => void = () => void this.showMenu(),
    ownership?: Ownership,
  ): void {
    this.setScreen('screens');
    renderDeckBuilder(mount(this.screens), {
      deck,
      ownership,
      onSave: (saved) => void onSave(saved),
      onCancel,
    });
  }

  private async saveDeck(deck: StoredDeck): Promise<void> {
    await this.backend.saveDeck(deck);
    await this.showMenu();
  }

  private async deleteDeck(id: string): Promise<void> {
    const answer = await showModal({
      title: '덱을 삭제합니다',
      actions: [
        { label: '취소', value: 'cancel' },
        { label: '삭제', value: 'delete', primary: true },
      ],
    });
    if (answer !== 'delete') return;
    await this.backend.deleteDeck(id);
    await this.showMenu();
  }

  private async loadPresets(): Promise<void> {
    for (const deck of PRESET_DECKS) await this.backend.saveDeck(deck);
    await this.showMenu();
  }

  private async startMatch(decks: StoredDeck[], deckAId: string, deckBId: string): Promise<void> {
    const deckA = decks.find((d) => d.id === deckAId);
    const deckB = decks.find((d) => d.id === deckBId);
    if (!deckA || !deckB) return;

    // 서버 구현에서는 큐 등록 시점에 서버가 다시 검증한다 (PLAN §5.2).
    for (const deck of [deckA, deckB]) {
      const validation = validateDeck(deck.pieces);
      if (!validation.ok) {
        await showModal({
          title: `${deck.name} 편성 불가`,
          body: validation.errors.join('<br>'),
          actions: [{ label: '확인', value: 'ok', primary: true }],
        });
        return;
      }
    }

    // 매치에 들어가는 것은 지금 시점의 덱 사본이다 (PLAN §5.2 덱 스냅샷).
    const snapshot = (deck: StoredDeck): DeckSnapshot => ({
      name: deck.name,
      pieces: deck.pieces.map((p) => ({ ...p })),
    });

    const view = await this.backend.createMatch(snapshot(deckA), snapshot(deckB));
    await this.enterMatch(view.matchId, this.backend);
  }

  /** 난이도를 고르면 즉시 매칭되어 시작한다 — 큐를 거치지 않는다. */
  private async startAiMatch(decks: StoredDeck[], deckId: string, difficulty: Difficulty): Promise<void> {
    const deck = decks.find((d) => d.id === deckId);
    if (!deck) return;

    const validation = validateDeck(deck.pieces);
    if (!validation.ok) {
      await showModal({
        title: `${deck.name} 편성 불가`,
        body: validation.errors.join('<br>'),
        actions: [{ label: '확인', value: 'ok', primary: true }],
      });
      return;
    }

    const playerDeck: DeckSnapshot = { name: deck.name, pieces: deck.pieces.map((p) => ({ ...p })) };
    const aiDeck: DeckSnapshot = { name: `AI (${DIFFICULTY_LABEL[difficulty]})`, pieces: AI_DECK_PIECES.map((p) => ({ ...p })) };

    const aiBackend = new AiMatchBackend();
    const view = await aiBackend.createMatch(playerDeck, aiDeck);
    await this.enterMatch(view.matchId, aiBackend, { fixedViewer: 'A', autoPlayer: createAiPlayer(difficulty) });
  }

  private async resumeMatch(): Promise<void> {
    const matchId = this.backend.resumableMatchId();
    if (matchId) await this.enterMatch(matchId, this.backend);
  }

  private async abandonMatch(): Promise<void> {
    const matchId = this.backend.resumableMatchId();
    if (matchId) await this.backend.abandonMatch(matchId);
    await this.showMenu();
  }

  private async enterMatch(
    matchId: string,
    backend: Backend,
    options: MatchOptions = {},
    onExit: () => void = () => void this.showMenu(),
  ): Promise<void> {
    // 매치가 이미 떠 있으면 무시한다 — 보드가 두 벌 생기는 사고를 막는 마지막 방어선.
    if (this.match) return;
    this.stopLobbyPoll();

    const view = await backend.getMatch(matchId);
    if (!view) {
      onExit();
      return;
    }

    this.setScreen('match');
    this.match = new MatchController(backend, this.boardEl, this.hudEl, onExit, options);
    await this.match.start(view);
  }

  // ---------- 온라인 대전 ----------

  private async showOnlineLobby(): Promise<void> {
    if (!onlineEnabled()) {
      await showModal({
        title: '온라인 대전',
        body: '서버 주소가 설정되지 않아 이 빌드에서는 온라인 대전을 쓸 수 없습니다.',
        actions: [{ label: '확인', value: 'ok', primary: true }],
      });
      return;
    }

    try {
      await api.me();
    } catch {
      this.showAuthScreen(null);
      return;
    }
    await this.renderLobbyScreen();
  }

  private showAuthScreen(error: string | null): void {
    this.stopLobbyPoll();
    this.setScreen('screens');
    renderAuth(mount(this.screens), error, {
      onLogin: (username, password) => void this.authenticate(() => api.login(username, password)),
      onSignup: (username, password) => void this.authenticate(() => api.signup(username, password)),
      onCancel: () => void this.showMenu(),
    });
  }

  private async authenticate(action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
      await this.renderLobbyScreen();
    } catch (error) {
      this.showAuthScreen(error instanceof ApiError ? error.message : '로그인에 실패했습니다');
    }
  }

  private async renderLobbyScreen(): Promise<void> {
    this.stopLobbyPoll();
    this.setScreen('screens');

    const [me, decks, matches, queue] = await Promise.all([
      api.me(),
      api.listDecks(),
      api.listMatches(),
      api.queueStatus().catch(() => null),
    ]);

    renderLobby(
      mount(this.screens),
      { username: me.username, decks, matches, queue },
      {
        onBack: () => void this.showMenu(),
        onLogout: () => void this.logout(),
        onNewDeck: () => void this.showOnlineDeckBuilder({ id: uid('deck'), name: '새 덱', pieces: [] }),
        onEditDeck: (id) => {
          const deck = decks.find((d) => d.id === id);
          if (deck) void this.showOnlineDeckBuilder(deck);
        },
        onDeleteDeck: (id) => void this.deleteOnlineDeck(id),
        onGacha: () => void this.showGachaScreen(),
        onJoinQueue: (deckId) => void this.joinQueue(deckId),
        onLeaveQueue: () => void this.leaveQueue(),
        onEnterMatch: (matchId) => void this.enterOnlineMatch(matchId),
        onCreateInvite: (deckId) => void this.createInvite(deckId),
        onJoinInvite: (code, deckId) => void this.joinInvite(code, deckId),
      },
    );

    // 대기 중이면 성사 여부를, 아니면 매치 목록 갱신(상대 수 반영)을 주기적으로 확인한다.
    this.lobbyPollHandle = setInterval(() => void this.pollLobby(), 4000);
  }

  private async pollLobby(): Promise<void> {
    if (this.match) return; // 매치 화면에 들어가 있으면 로비 폴링은 의미 없다.
    const status = await api.queueStatus().catch(() => null);
    if (status?.status === 'matched' && status.matchId) {
      await this.enterOnlineMatch(status.matchId);
      return;
    }
    await this.renderLobbyScreen();
  }

  private async showOnlineDeckBuilder(deck: StoredDeck): Promise<void> {
    this.stopLobbyPoll();
    // 온라인 덱은 서버가 소유권을 재검증하므로(§ "가챠 게이트의 기준", README) 여기서도 같은
    // 인벤토리로 미리 걸러 준다 — 로컬/AI 핫시트 덱빌더는 이 인자를 넘기지 않아 게이트가 없다.
    const inventory = await api.getInventory().catch(() => null);
    const ownership: Ownership | undefined = inventory
      ? { bases: new Set(inventory.bases), skills: new Set(inventory.skills) }
      : undefined;

    this.showDeckBuilder(
      deck,
      async (saved) => {
        await api.saveDeck(saved);
        await this.renderLobbyScreen();
      },
      () => void this.renderLobbyScreen(),
      ownership,
    );
  }

  private async deleteOnlineDeck(id: string): Promise<void> {
    const answer = await showModal({
      title: '덱을 삭제합니다',
      actions: [
        { label: '취소', value: 'cancel' },
        { label: '삭제', value: 'delete', primary: true },
      ],
    });
    if (answer !== 'delete') return;
    await api.deleteDeck(id);
    await this.renderLobbyScreen();
  }

  private async logout(): Promise<void> {
    await api.logout().catch(() => undefined);
    await this.showMenu();
  }

  private async joinQueue(deckId: string): Promise<void> {
    try {
      const status = await api.joinQueue(deckId);
      if (status.status === 'matched' && status.matchId) {
        await this.enterOnlineMatch(status.matchId);
        return;
      }
      await this.renderLobbyScreen();
    } catch (error) {
      await this.notifyError(error);
    }
  }

  private async leaveQueue(): Promise<void> {
    const status = await api.leaveQueue().catch(() => null);
    if (status?.status === 'matched' && status.matchId) {
      await this.enterOnlineMatch(status.matchId);
      return;
    }
    await this.renderLobbyScreen();
  }

  private async createInvite(deckId: string): Promise<void> {
    try {
      const { code } = await api.createPrivateMatch(deckId);
      await showModal({
        title: '초대 코드가 생성되었습니다',
        body: `<span class="mono" style="font-size:20px">${code}</span><br><span class="muted">1시간 동안 유효합니다. 상대에게 전달하세요.</span>`,
        actions: [{ label: '확인', value: 'ok', primary: true }],
      });
    } catch (error) {
      await this.notifyError(error);
    }
  }

  private async joinInvite(code: string, deckId: string): Promise<void> {
    try {
      const { matchId } = await api.joinPrivateMatch(code, deckId);
      await this.enterOnlineMatch(matchId);
    } catch (error) {
      await this.notifyError(error);
    }
  }

  private async enterOnlineMatch(matchId: string): Promise<void> {
    const detail = await api.getMatch(matchId).catch(() => null);
    if (!detail) {
      await this.renderLobbyScreen();
      return;
    }
    await this.enterMatch(
      matchId,
      this.remoteBackend,
      { fixedViewer: detail.role, pollMs: 4000 },
      () => void this.renderLobbyScreen(),
    );
  }

  private async showGachaScreen(): Promise<void> {
    this.stopLobbyPoll();
    const inventory = await api.getInventory().catch(() => null);
    if (!inventory) {
      await this.notifyError(null);
      return;
    }

    this.setScreen('screens');
    renderGacha(mount(this.screens), inventory, {
      onBack: () => void this.renderLobbyScreen(),
      onPull: async () => {
        try {
          return await api.gachaPull();
        } catch (error) {
          await this.notifyError(error);
          return null;
        }
      },
    });
  }

  private async notifyError(error: unknown): Promise<void> {
    await showModal({
      title: '오류',
      body: error instanceof ApiError ? error.message : '요청을 처리하지 못했습니다',
      actions: [{ label: '확인', value: 'ok', primary: true }],
    });
    await this.renderLobbyScreen();
  }
}
