import { validateDeck } from '@tessera/data';
import type { DeckSnapshot } from '@tessera/rules';
import { LocalBackend } from './backend/local';
import type { StoredDeck } from './backend/types';
import { MatchController } from './match';
import { PRESET_DECKS } from './presets';
import { mount, uid } from './ui/dom';
import { renderDeckBuilder } from './ui/deckbuilder';
import { renderMenu } from './ui/menu';
import { showModal } from './ui/modal';

export class App {
  private readonly backend = new LocalBackend();
  private readonly screens = document.getElementById('screens') as HTMLElement;
  private readonly matchEl = document.getElementById('match') as HTMLElement;
  private readonly boardEl = document.getElementById('board') as HTMLElement;
  private readonly hudEl = document.getElementById('hud') as HTMLElement;
  private match: MatchController | null = null;

  async start(): Promise<void> {
    await this.showMenu();
  }

  private setScreen(mode: 'screens' | 'match'): void {
    this.screens.hidden = mode !== 'screens';
    this.matchEl.hidden = mode !== 'match';
  }

  private async showMenu(): Promise<void> {
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
        onResume: () => void this.resumeMatch(),
        onAbandon: () => void this.abandonMatch(),
      },
    );
  }

  private showDeckBuilder(deck: StoredDeck): void {
    this.setScreen('screens');
    renderDeckBuilder(mount(this.screens), {
      deck,
      onSave: (saved) => void this.saveDeck(saved),
      onCancel: () => void this.showMenu(),
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
    await this.enterMatch(view.matchId);
  }

  private async resumeMatch(): Promise<void> {
    const matchId = this.backend.resumableMatchId();
    if (matchId) await this.enterMatch(matchId);
  }

  private async abandonMatch(): Promise<void> {
    const matchId = this.backend.resumableMatchId();
    if (matchId) await this.backend.abandonMatch(matchId);
    await this.showMenu();
  }

  private async enterMatch(matchId: string): Promise<void> {
    // 매치가 이미 떠 있으면 무시한다 — 보드가 두 벌 생기는 사고를 막는 마지막 방어선.
    if (this.match) return;

    const view = await this.backend.getMatch(matchId);
    if (!view) {
      await this.showMenu();
      return;
    }

    this.setScreen('match');
    this.match = new MatchController(this.backend, this.boardEl, this.hudEl, () => void this.showMenu());
    await this.match.start(view);
  }
}
