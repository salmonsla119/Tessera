import { DECK_BUDGET, validateDeck } from '@tessera/data';
import type { MatchSummary, OnlineDeck, QueueStatus } from '../online/api';
import { $, delegate, esc, html } from './dom';

export interface LobbyState {
  username: string;
  decks: OnlineDeck[];
  queue: QueueStatus | null;
  matches: MatchSummary[];
}

export interface LobbyHandlers {
  onLogout: () => void;
  onBack: () => void;
  onNewDeck: () => void;
  onEditDeck: (id: string) => void;
  onDeleteDeck: (id: string) => void;
  onJoinQueue: (deckId: string) => void;
  onLeaveQueue: () => void;
  onEnterMatch: (matchId: string) => void;
  onCreateInvite: (deckId: string) => void;
  onJoinInvite: (code: string, deckId: string) => void;
}

const PHASE_LABEL: Record<MatchSummary['phase'], string> = {
  deploying: '배치 중',
  battle: '전투 중',
  finished: '종료',
};

export function renderLobby(container: HTMLElement, state: LobbyState, handlers: LobbyHandlers): void {
  const { username, decks, queue, matches } = state;
  const playable = decks.filter((d) => validateDeck(d.pieces).ok);
  const deckOptions = playable
    .map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`)
    .join('');
  const waiting = queue?.status === 'waiting';

  html(
    container,
    `<div class="screen">
      <div class="screen-head">
        <div>
          <h1 class="brand">온라인 <span>대전</span></h1>
          <p>${esc(username)}님으로 로그인됨</p>
        </div>
        <div class="row">
          <button data-act="back" class="ghost">메뉴로</button>
          <button data-act="logout" class="ghost danger">로그아웃</button>
        </div>
      </div>

      <div class="grid-2">
        <div style="display:grid;gap:16px">
          <div class="panel">
            <h3>매칭</h3>
            ${
              playable.length === 0
                ? '<div class="notice" style="margin-top:10px">편성 가능한 온라인 덱이 최소 1개 필요합니다.</div>'
                : waiting
                  ? `<div class="row" style="justify-content:space-between;margin-top:10px">
                       <span class="muted">대기 중 · 현재 ${queue?.waitingCount ?? '?'}명 대기 중입니다. 창을 닫아도 유지됩니다.</span>
                       <button data-act="leave-queue" class="danger ghost">취소</button>
                     </div>`
                  : `<div style="display:grid;gap:10px;margin-top:10px">
                       <select id="deck-queue">${deckOptions}</select>
                       <button data-act="join-queue" class="primary">매칭 등록</button>
                     </div>`
            }
          </div>

          <div class="panel">
            <h3>친구 대전</h3>
            <p class="muted" style="margin:4px 0 12px">초대 코드를 만들어 공유하거나, 받은 코드로 참가합니다.</p>
            ${
              playable.length === 0
                ? '<div class="notice">편성 가능한 온라인 덱이 필요합니다.</div>'
                : `<div style="display:grid;gap:10px">
                     <div class="row">
                       <select id="deck-invite" style="flex:1">${deckOptions}</select>
                       <button data-act="create-invite">코드 만들기</button>
                     </div>
                     <div class="row">
                       <input type="text" id="invite-code" placeholder="초대 코드" style="flex:1" maxlength="8" />
                       <button data-act="join-invite">참가</button>
                     </div>
                   </div>`
            }
          </div>

          <div class="panel">
            <h3>내 온라인 덱</h3>
            <div class="row" style="justify-content:flex-end;margin-bottom:10px">
              <button data-act="new-deck" class="primary">새 덱</button>
            </div>
            <div class="deck-list">
              ${
                decks.length === 0
                  ? '<div class="roster-empty">저장된 온라인 덱이 없습니다.</div>'
                  : decks
                      .map((deck) => {
                        const v = validateDeck(deck.pieces);
                        return `<div class="deck-card ${v.ok ? '' : 'invalid'}">
                          <div>
                            <strong>${esc(deck.name)}</strong>
                            <div class="meta">${deck.pieces.length}기물 · ${v.cost}/${DECK_BUDGET}코스트
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
        </div>

        <div class="panel">
          <h3>진행 중인 매치</h3>
          <div class="deck-list" style="margin-top:10px">
            ${
              matches.length === 0
                ? '<div class="roster-empty">진행 중인 매치가 없습니다. 매칭에 등록해 보세요.</div>'
                : matches
                    .map(
                      (m) => `<div class="deck-card">
                        <div>
                          <strong>vs ${esc(m.opponentUsername)}</strong>
                          <div class="meta">
                            ${PHASE_LABEL[m.phase]} · 나는 플레이어 ${m.role}
                            ${m.myTurn ? ' · <span style="color:var(--ok)">내 턴</span>' : ''}
                          </div>
                        </div>
                        <button data-enter="${esc(m.id)}" class="primary">입장</button>
                      </div>`,
                    )
                    .join('')
            }
          </div>
        </div>
      </div>
    </div>`,
  );

  delegate(container, 'button[data-act]', (button) => {
    switch (button.dataset.act) {
      case 'back':
        handlers.onBack();
        break;
      case 'logout':
        handlers.onLogout();
        break;
      case 'new-deck':
        handlers.onNewDeck();
        break;
      case 'join-queue':
        handlers.onJoinQueue($<HTMLSelectElement>(container, '#deck-queue').value);
        break;
      case 'leave-queue':
        handlers.onLeaveQueue();
        break;
      case 'create-invite':
        handlers.onCreateInvite($<HTMLSelectElement>(container, '#deck-invite').value);
        break;
      case 'join-invite': {
        const code = $<HTMLInputElement>(container, '#invite-code').value.trim();
        const deckId = $<HTMLSelectElement>(container, '#deck-invite').value;
        if (code) handlers.onJoinInvite(code, deckId);
        break;
      }
    }
  });

  delegate(container, 'button[data-edit]', (button) => handlers.onEditDeck(button.dataset.edit!));
  delegate(container, 'button[data-delete]', (button) => handlers.onDeleteDeck(button.dataset.delete!));
  delegate(container, 'button[data-enter]', (button) => handlers.onEnterMatch(button.dataset.enter!));
}
