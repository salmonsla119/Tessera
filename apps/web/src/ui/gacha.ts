import { BASES, GACHA_PULL_COST, SELECTABLE_SKILLS, skillRangeCategory, type Base, type Skill } from '@tessera/data';
import { RARITY_COLOR, RARITY_LABEL, SKILL_KIND_COLOR, SKILL_KIND_LABEL, SKILL_RANGE_COLOR, SKILL_RANGE_LABEL } from '../game/theme';
import type { GachaPullResult, Inventory } from '../online/api';
import { delegate, esc, html } from './dom';

export interface GachaHandlers {
  onBack: () => void;
  /** 실패(재화 부족 등)하면 null을 돌려준다 — 오류 메시지는 호출부(app.ts)가 모달로 보여준다. */
  onPull: () => Promise<GachaPullResult | null>;
}

function ownedRow(name: string, rarity: string, owned: boolean, detail: string): string {
  return `<tr class="${owned ? '' : 'muted'}">
    <td>${esc(name)}</td>
    <td><span class="tag" style="color:${RARITY_COLOR[rarity as keyof typeof RARITY_COLOR]}">${RARITY_LABEL[rarity as keyof typeof RARITY_LABEL]}</span></td>
    <td style="text-align:left">${detail}</td>
    <td>${owned ? '<span style="color:var(--ok)">보유</span>' : '<span class="muted">미보유</span>'}</td>
  </tr>`;
}

function baseDetail(b: Base): string {
  return `<span class="muted" style="font-size:11px">${esc(b.moveLabel)}</span> · HP${b.hp} ATK${b.atk} SP${b.sp} EVA${b.eva} SPD${b.spd} · C${b.cost}`;
}

function skillDetail(s: Skill): string {
  const category = skillRangeCategory(s);
  const amount = s.kind === 'damage' ? `${s.minDamage}~${s.maxDamage}` : `+${s.minDamage}~${s.maxDamage}${s.kind === 'defense' ? '%' : ''}`;
  return `<span class="tag" style="color:${SKILL_KIND_COLOR[s.kind]}">${SKILL_KIND_LABEL[s.kind]}</span>
    <span class="tag" style="color:${SKILL_RANGE_COLOR[category]}">${SKILL_RANGE_LABEL[category]}</span>
    <span class="muted" style="font-size:11px">${amount} · C${s.cost}</span>`;
}

export function renderGacha(container: HTMLElement, initialInventory: Inventory, handlers: GachaHandlers): void {
  const inventory: Inventory = {
    currency: initialInventory.currency,
    bases: [...initialInventory.bases],
    skills: [...initialInventory.skills],
  };
  let lastResult: GachaPullResult | null = null;
  let pulling = false;

  function render(): void {
    const canPull = !pulling && inventory.currency >= GACHA_PULL_COST;
    const ownedBases = new Set(inventory.bases);
    const ownedSkills = new Set(inventory.skills);

    html(
      container,
      `<div class="screen">
        <div class="screen-head">
          <div>
            <h1>가챠</h1>
            <p>보유 재화 <span class="mono">${inventory.currency}</span> · 1회 비용 ${GACHA_PULL_COST}</p>
          </div>
          <button data-act="back" class="ghost">돌아가기</button>
        </div>

        <div class="panel" style="text-align:center">
          <button data-act="pull" class="primary" style="width:240px" ${canPull ? '' : 'disabled'}>
            ${pulling ? '뽑는 중…' : `가챠 뽑기 (−${GACHA_PULL_COST})`}
          </button>
          ${
            !canPull && !pulling
              ? '<div class="muted" style="margin-top:8px;font-size:12px">재화가 부족합니다 — 매치를 완료하면 1회분씩 지급됩니다.</div>'
              : ''
          }
          ${
            lastResult
              ? `<div class="notice" style="margin-top:14px;text-align:left">
                   <strong>${lastResult.duplicate ? '중복!' : '새 항목 획득!'}</strong>
                   <span class="tag" style="color:${RARITY_COLOR[lastResult.item.rarity]};margin-left:6px">${RARITY_LABEL[lastResult.item.rarity]}</span>
                   <div style="margin-top:4px">${esc(itemName(lastResult.item.itemType, lastResult.item.itemId))}</div>
                   ${lastResult.duplicate ? `<div class="muted" style="font-size:12px">이미 보유 중 — 재화 ${lastResult.refund} 환급</div>` : ''}
                 </div>`
              : ''
          }
        </div>

        <div class="grid-2">
          <div class="panel">
            <h3>베이스 (${ownedBases.size}/${BASES.length})</h3>
            <table class="data">
              <thead><tr><th>이름</th><th>등급</th><th>정보</th><th>보유</th></tr></thead>
              <tbody>${BASES.map((b) => ownedRow(b.name, b.rarity, ownedBases.has(b.id), baseDetail(b))).join('')}</tbody>
            </table>
          </div>
          <div class="panel">
            <h3>스킬 (${ownedSkills.size}/${SELECTABLE_SKILLS.length})</h3>
            <table class="data">
              <thead><tr><th>이름</th><th>등급</th><th>정보</th><th>보유</th></tr></thead>
              <tbody>${SELECTABLE_SKILLS.map((s) => ownedRow(s.name, s.rarity, ownedSkills.has(s.id), skillDetail(s))).join('')}</tbody>
            </table>
          </div>
        </div>
      </div>`,
    );
  }

  function itemName(itemType: 'base' | 'skill', itemId: string): string {
    const item = itemType === 'base' ? BASES.find((b) => b.id === itemId) : SELECTABLE_SKILLS.find((s) => s.id === itemId);
    return item?.name ?? itemId;
  }

  async function doPull(): Promise<void> {
    if (pulling || inventory.currency < GACHA_PULL_COST) return;
    pulling = true;
    render();

    const result = await handlers.onPull();
    pulling = false;
    if (result) {
      lastResult = result;
      inventory.currency = result.currency;
      if (!result.duplicate) {
        const list = result.item.itemType === 'base' ? inventory.bases : inventory.skills;
        list.push(result.item.itemId);
      }
    }
    render();
  }

  // 재렌더링해도 리스너가 중복 등록되지 않게, 델리게이션은 딱 한 번만 붙인다 (deckbuilder.ts와 동일한 패턴).
  delegate(container, 'button[data-act]', (button) => {
    switch (button.dataset.act) {
      case 'back':
        handlers.onBack();
        break;
      case 'pull':
        void doPull();
        break;
    }
  });

  render();
}
