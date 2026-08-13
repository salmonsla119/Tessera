import {
  BASES,
  DECK_BUDGET,
  MAX_PIECES,
  SELECTABLE_SKILLS,
  requireBase,
  requireSkill,
  skillRangeCategory,
  validateDeck,
  type DeckPiece,
} from '@tessera/data';
import { accrueAp } from '@tessera/rules';
import type { StoredDeck } from '../backend/types';
import {
  describePassive,
  RARITY_COLOR,
  RARITY_LABEL,
  SKILL_KIND_COLOR,
  SKILL_KIND_LABEL,
  SKILL_RANGE_COLOR,
  SKILL_RANGE_LABEL,
} from '../game/theme';
import { $, delegate, esc, html } from './dom';

const SHAPE_LABEL: Record<string, string> = {
  adjacent: '인접',
  orth: '직선',
  diag: '대각',
  all8: '8방향',
  area: '전방향',
};

/** 팀 속도로 첫 5턴 행동 횟수를 미리 보여 준다 (GDD §2.3). */
function apPreview(teamSpeed: number): string {
  if (teamSpeed === 0) return '—';
  let carry = 0;
  const turns: number[] = [];
  for (let i = 0; i < 5; i++) {
    const result = accrueAp(carry, teamSpeed);
    carry = result.carryTenths;
    turns.push(result.ap);
  }
  return turns.join(' · ');
}

/**
 * 온라인 덱빌더에서만 넘어온다 — 보유하지 않은 베이스/스킬은 고를 수 없게 잠근다.
 * 로컬/AI 핫시트 덱빌더는 계정이 필요 없으므로 이 게이트를 건너뛴다(넘기지 않으면 전부 보유한 것으로 취급).
 */
export interface Ownership {
  bases: ReadonlySet<string>;
  skills: ReadonlySet<string>;
}

export function renderDeckBuilder(
  container: HTMLElement,
  options: { deck: StoredDeck; ownership?: Ownership; onSave: (deck: StoredDeck) => void; onCancel: () => void },
): void {
  let name = options.deck.name;
  let pieces: DeckPiece[] = options.deck.pieces.map((p) => ({ ...p }));
  const ownsBase = (id: string) => !options.ownership || options.ownership.bases.has(id);
  const ownsSkill = (id: string) => !options.ownership || options.ownership.skills.has(id);
  let selectedBase = (BASES.find((b) => ownsBase(b.id)) ?? BASES[0]!).id;
  let selectedSkill = (SELECTABLE_SKILLS.find((s) => ownsSkill(s.id)) ?? SELECTABLE_SKILLS[0]!).id;

  html(
    container,
    `<div class="screen">
      <div class="screen-head">
        <div>
          <h1>덱 편성</h1>
          <p>기물 1개 = 베이스 1개 + 스킬 1개. 최대 ${MAX_PIECES}기물, 총 예산 ${DECK_BUDGET}코스트.</p>
        </div>
        <div class="row">
          <button data-act="cancel" class="ghost">취소</button>
          <button data-act="save" class="primary">저장</button>
        </div>
      </div>
      <div class="builder">
        <div style="display:grid;gap:16px">
          <div class="panel">
            <h3>베이스</h3>
            <table class="data" id="bases"></table>
          </div>
          <div class="panel">
            <h3>스킬</h3>
            <table class="data" id="skills"></table>
          </div>
        </div>
        <div style="display:grid;gap:16px">
          <div class="panel" id="summary"></div>
          <div class="panel">
            <h3>편성</h3>
            <div class="roster" id="roster"></div>
            <button data-act="add" class="primary" style="width:100%;margin-top:12px">기물 추가</button>
          </div>
        </div>
      </div>
    </div>`,
  );

  const basesEl = $(container, '#bases');
  const skillsEl = $(container, '#skills');
  const rosterEl = $(container, '#roster');
  const summaryEl = $(container, '#summary');

  function rarityTag(rarity: keyof typeof RARITY_LABEL): string {
    return `<span class="tag" style="color:${RARITY_COLOR[rarity]}">${RARITY_LABEL[rarity]}</span>`;
  }

  function renderBases(): void {
    html(
      basesEl,
      `<thead><tr><th>이름</th><th>등급</th><th>이동</th><th>HP</th><th>ATK</th><th>SP</th><th>EVA</th><th>SPD</th><th>C</th><th>패시브</th></tr></thead>
       <tbody>${BASES.map((b) => {
         const locked = !ownsBase(b.id);
         return `<tr data-base="${b.id}" class="${b.id === selectedBase ? 'selected' : ''} ${locked ? 'locked' : ''}">
            <td>${esc(b.name)}${locked ? ' <span class="muted" style="font-size:11px">🔒 미보유</span>' : ''}</td>
            <td>${rarityTag(b.rarity)}</td>
            <td class="muted" style="font-size:11px">${esc(b.moveLabel)}</td>
            <td>${b.hp}</td><td>${b.atk}</td><td>${b.sp}</td><td>${b.eva}</td><td>${b.spd}</td><td>${b.cost}</td>
            <td class="muted" style="font-size:11px;text-align:left">${b.passive ? esc(describePassive(b.passive)) : '—'}</td>
          </tr>`;
       }).join('')}</tbody>`,
    );
  }

  function renderSkills(): void {
    html(
      skillsEl,
      `<thead><tr><th>이름</th><th>등급</th><th>종류</th><th>유형</th><th>데미지/회복</th><th>사거리</th><th>형태</th><th>SP</th><th>C</th></tr></thead>
       <tbody>${SELECTABLE_SKILLS.map((s) => {
         const amount =
           s.kind === 'damage' ? `${s.minDamage}~${s.maxDamage}` : `+${s.minDamage}~${s.maxDamage}${s.kind === 'defense' ? '%' : ''}`;
         const category = skillRangeCategory(s);
         const splash = s.splashRadius > 0 ? ` (R${s.splashRadius})` : '';
         const locked = !ownsSkill(s.id);
         return `<tr data-skill="${s.id}" class="${s.id === selectedSkill ? 'selected' : ''} ${locked ? 'locked' : ''}">
            <td>${esc(s.name)}${locked ? ' <span class="muted" style="font-size:11px">🔒 미보유</span>' : ''}${s.note ? `<div class="muted" style="font-size:11px">${esc(s.note)}</div>` : ''}</td>
            <td>${rarityTag(s.rarity)}</td>
            <td><span class="tag" style="color:${SKILL_KIND_COLOR[s.kind]}">${SKILL_KIND_LABEL[s.kind]}</span></td>
            <td><span class="tag" style="color:${SKILL_RANGE_COLOR[category]}">${SKILL_RANGE_LABEL[category]}${splash}</span></td>
            <td style="color:${s.kind === 'damage' ? '' : SKILL_KIND_COLOR[s.kind]}">${amount}</td><td>${s.range}</td>
            <td>${esc(SHAPE_LABEL[s.shape] ?? s.shape)}</td><td>${s.spCost}</td><td>${s.cost}</td>
          </tr>`;
       }).join('')}</tbody>`,
    );
  }

  function renderRoster(): void {
    if (pieces.length === 0) {
      html(rosterEl, `<div class="roster-empty">아직 편성한 기물이 없습니다</div>`);
      return;
    }
    html(
      rosterEl,
      pieces
        .map((piece, index) => {
          const base = requireBase(piece.baseId);
          const skill = requireSkill(piece.skillId);
          return `<div class="roster-item">
            <div>
              <strong>${esc(base.name)}</strong>
              <span class="muted"> · ${esc(skill.name)}</span>
              <div class="muted" style="font-size:11px">SPD ${base.spd} · SP ${base.sp}</div>
            </div>
            <div class="row">
              <span class="mono">${base.cost + skill.cost}</span>
              <button data-remove="${index}" class="ghost" title="제거">✕</button>
            </div>
          </div>`;
        })
        .join(''),
    );
  }

  function renderSummary(): void {
    const validation = validateDeck(pieces);
    const over = validation.cost > DECK_BUDGET;
    const percent = Math.min(100, (validation.cost / DECK_BUDGET) * 100);

    html(
      summaryEl,
      `<label class="muted" style="font-size:12px">덱 이름</label>
       <input type="text" id="deck-name" value="${esc(name)}" maxlength="24" />
       <div class="budget ${over ? 'over' : ''}" style="margin-top:14px">
         <span class="mono">${validation.cost}</span><span class="muted" style="font-size:14px">/ ${DECK_BUDGET} 코스트</span>
       </div>
       <div class="bar ${over ? 'over' : ''}"><i style="width:${percent}%"></i></div>
       <div class="stat-grid" style="margin-top:14px">
         <div><span>기물</span><span>${pieces.length} / ${MAX_PIECES}</span></div>
         <div><span>팀 속도</span><span>${validation.speed}</span></div>
       </div>
       <div style="margin-top:12px">
         <div class="muted" style="font-size:12px">턴당 행동 횟수 (1~5턴)</div>
         <div class="mono" style="font-size:16px">${apPreview(validation.speed)}</div>
       </div>
       ${
         validation.errors.length > 0
           ? `<ul class="errors">${validation.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`
           : `<div class="tag" style="margin-top:12px;color:var(--ok);border-color:#2c5a3c">편성 가능</div>`
       }`,
    );

    $<HTMLInputElement>(summaryEl, '#deck-name').addEventListener('input', (event) => {
      name = (event.target as HTMLInputElement).value;
    });
  }

  function renderAll(): void {
    renderBases();
    renderSkills();
    renderRoster();
    renderSummary();
  }

  delegate(basesEl, 'tr[data-base]', (row) => {
    if (!ownsBase(row.dataset.base!)) return;
    selectedBase = row.dataset.base!;
    renderBases();
  });

  delegate(skillsEl, 'tr[data-skill]', (row) => {
    if (!ownsSkill(row.dataset.skill!)) return;
    selectedSkill = row.dataset.skill!;
    renderSkills();
  });

  delegate(rosterEl, 'button[data-remove]', (button) => {
    pieces.splice(Number(button.dataset.remove), 1);
    renderRoster();
    renderSummary();
  });

  delegate(container, 'button[data-act]', (button) => {
    switch (button.dataset.act) {
      case 'add':
        if (pieces.length >= MAX_PIECES) return;
        pieces.push({ baseId: selectedBase, skillId: selectedSkill });
        renderRoster();
        renderSummary();
        break;
      case 'save':
        options.onSave({ id: options.deck.id, name: name.trim() || '이름 없는 덱', pieces });
        break;
      case 'cancel':
        options.onCancel();
        break;
    }
  });

  renderAll();
}
