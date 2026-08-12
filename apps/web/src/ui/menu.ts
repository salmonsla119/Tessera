import { DECK_BUDGET, validateDeck } from '@tessera/data';
import type { Difficulty } from '../ai/policy';
import { DIFFICULTY_LABEL } from '../ai/policy';
import type { StoredDeck } from '../backend/types';
import { $, delegate, esc, html } from './dom';

export interface MenuHandlers {
  onNewDeck: () => void;
  onEditDeck: (id: string) => void;
  onDeleteDeck: (id: string) => void;
  onLoadPresets: () => void;
  onStart: (deckAId: string, deckBId: string) => void;
  onStartAi: (deckId: string, difficulty: Difficulty) => void;
  onResume: () => void;
  onAbandon: () => void;
  onOnline: () => void;
}

export function renderMenu(
  container: HTMLElement,
  state: { decks: StoredDeck[]; resumable: boolean },
  handlers: MenuHandlers,
): void {
  const { decks, resumable } = state;
  const playable = decks.filter((d) => validateDeck(d.pieces).ok);

  const deckOptions = (selectedIndex: number) =>
    playable
      .map((d, i) => `<option value="${esc(d.id)}" ${i === selectedIndex ? 'selected' : ''}>${esc(d.name)}</option>`)
      .join('');

  html(
    container,
    `<div class="screen">
      <div class="screen-head">
        <div>
          <h1 class="brand">TES<span>SERA</span></h1>
          <p>8×8 격자 위의 턴제 덱빌딩 전술. 팀 공용 행동력을 배분해 상대를 전멸시킨다.</p>
        </div>
      </div>

      ${
        resumable
          ? `<div class="panel" style="margin-bottom:16px">
              <div class="row" style="justify-content:space-between">
                <div><strong>진행 중인 매치가 있습니다</strong><div class="muted">브라우저를 닫아도 로컬에 저장됩니다.</div></div>
                <div class="row">
                  <button data-act="abandon" class="danger ghost">포기</button>
                  <button data-act="resume" class="primary">이어하기</button>
                </div>
              </div>
            </div>`
          : ''
      }

      <div class="grid-2">
        <div class="panel">
          <div class="row" style="justify-content:space-between;margin-bottom:12px">
            <h3>내 덱</h3>
            <div class="row">
              ${decks.length === 0 ? '<button data-act="presets">예시 덱 불러오기</button>' : ''}
              <button data-act="new" class="primary">새 덱</button>
            </div>
          </div>
          <div class="deck-list" id="decks">
            ${
              decks.length === 0
                ? '<div class="roster-empty">저장된 덱이 없습니다. 예시 덱을 불러오거나 새로 만드세요.</div>'
                : decks
                    .map((deck) => {
                      const v = validateDeck(deck.pieces);
                      return `<div class="deck-card ${v.ok ? '' : 'invalid'}">
                        <div>
                          <strong>${esc(deck.name)}</strong>
                          <div class="meta">${deck.pieces.length}기물 · ${v.cost}/${DECK_BUDGET}코스트 · 속도 ${v.speed}
                          ${v.ok ? '' : ' · <span style="color:var(--danger)">편성 불가</span>'}</div>
                        </div>
                        <div class="row">
                          <button data-edit="${esc(deck.id)}" class="ghost">편집</button>
                          <button data-delete="${esc(deck.id)}" class="ghost danger">삭제</button>
                        </div>
                      </div>`;
                    })
                    .join('')
            }
          </div>
        </div>

        <div style="display:grid;gap:16px;align-content:start">
          <div class="panel">
            <h3>로컬 핫시트 대전</h3>
            <p class="muted" style="margin:4px 0 14px">한 화면에서 두 사람이 번갈아 플레이합니다. 배치 단계와 턴 교대 사이에 가림막이 들어갑니다.</p>
            ${
              playable.length === 0
                ? '<div class="notice">편성 가능한 덱이 최소 1개 필요합니다.</div>'
                : `<div style="display:grid;gap:10px">
                     <label style="display:grid;gap:4px"><span class="muted" style="font-size:12px">플레이어 A</span>
                       <select id="deck-a">${deckOptions(0)}</select></label>
                     <label style="display:grid;gap:4px"><span class="muted" style="font-size:12px">플레이어 B</span>
                       <select id="deck-b">${deckOptions(Math.min(1, playable.length - 1))}</select></label>
                     <button data-act="start" class="primary" style="margin-top:4px">대전 시작</button>
                   </div>`
            }
          </div>

          <div class="panel">
            <h3>AI와 대전</h3>
            <p class="muted" style="margin:4px 0 12px">난이도를 고르면 바로 매칭되어 대전이 시작됩니다.</p>
            ${
              playable.length === 0
                ? '<div class="notice">편성 가능한 덱이 최소 1개 필요합니다.</div>'
                : `<div style="display:grid;gap:10px">
                     <label style="display:grid;gap:4px"><span class="muted" style="font-size:12px">내 덱</span>
                       <select id="deck-ai">${deckOptions(0)}</select></label>
                     <div class="row" style="gap:8px">
                       <button data-difficulty="easy" style="flex:1">${DIFFICULTY_LABEL.easy}</button>
                       <button data-difficulty="medium" style="flex:1">${DIFFICULTY_LABEL.medium}</button>
                       <button data-difficulty="hard" style="flex:1">${DIFFICULTY_LABEL.hard}</button>
                     </div>
                   </div>`
            }
          </div>

          <div class="panel">
            <h3>온라인 비동기 대전</h3>
            <p class="muted" style="margin:4px 0 12px">매칭 큐와 서버 권위 판정이 붙는 모드입니다. 로그인 후 큐에 등록하면 상대가 잡힐 때까지 기다립니다.</p>
            <button data-act="online" class="primary" style="width:100%">온라인 대전 열기</button>
          </div>
        </div>
      </div>
    </div>`,
  );

  delegate(container, 'button[data-act]', (button) => {
    switch (button.dataset.act) {
      case 'new':
        handlers.onNewDeck();
        break;
      case 'presets':
        handlers.onLoadPresets();
        break;
      case 'resume':
        handlers.onResume();
        break;
      case 'abandon':
        handlers.onAbandon();
        break;
      case 'start': {
        const a = $<HTMLSelectElement>(container, '#deck-a').value;
        const b = $<HTMLSelectElement>(container, '#deck-b').value;
        handlers.onStart(a, b);
        break;
      }
      case 'online':
        handlers.onOnline();
        break;
    }
  });

  delegate(container, 'button[data-difficulty]', (button) => {
    const deckId = $<HTMLSelectElement>(container, '#deck-ai').value;
    handlers.onStartAi(deckId, button.dataset.difficulty as Difficulty);
  });

  delegate(container, 'button[data-edit]', (button) => handlers.onEditDeck(button.dataset.edit!));
  delegate(container, 'button[data-delete]', (button) => handlers.onDeleteDeck(button.dataset.delete!));
}
