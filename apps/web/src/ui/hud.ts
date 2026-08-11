import { requireBase, type Skill } from '@tessera/data';
import { formatCarry, type DamageRange, type PieceState, type PlayerId } from '@tessera/rules';
import { baseName, skillName } from '../game/theme';
import { delegate, esc, html } from './dom';

export interface LogEntry {
  text: string;
  owner?: PlayerId;
  highlight?: boolean;
}

export interface HudModel {
  phase: 'deploying' | 'battle' | 'finished';
  viewer: PlayerId;
  round: number;
  ap: number;
  /** 이번 턴 시작 시 받은 행동 횟수 — "3 / 4" 표기의 분모. */
  apMax: number;
  carryTenths: number;
  teamSpeed: number;
  aliveA: number;
  aliveB: number;
  suddenDeath: boolean;
  selected: PieceState | null;
  activeSkillId: string | null;
  usableSkills: Skill[];
  /** SP 부족으로 잠긴 편성 스킬 — 잠금 상태를 보여 주려고 따로 받는다. */
  lockedSkill: Skill | null;
  canFocus: boolean;
  deployRemaining: number;
  preview: { targetName: string; range: DamageRange; distance: number } | null;
  log: LogEntry[];
}

export interface HudHandlers {
  onSelectSkill: (skillId: string) => void;
  onFocus: () => void;
  onEndTurn: () => void;
  onSubmitDeploy: () => void;
  onExit: () => void;
}

export class Hud {
  /** destroy()로 리스너를 끊는다 — 같은 #hud를 다음 매치에서 다시 쓰기 때문. */
  private readonly listeners = new AbortController();

  constructor(
    private readonly root: HTMLElement,
    handlers: HudHandlers,
  ) {
    const signal = this.listeners.signal;
    delegate(root, 'button[data-skill]', (b) => handlers.onSelectSkill(b.dataset.skill!), signal);
    delegate(
      root,
      'button[data-act]',
      (b) => {
        switch (b.dataset.act) {
          case 'focus':
            handlers.onFocus();
            break;
          case 'end-turn':
            handlers.onEndTurn();
            break;
          case 'submit-deploy':
            handlers.onSubmitDeploy();
            break;
          case 'exit':
            handlers.onExit();
            break;
        }
      },
      signal,
    );
  }

  destroy(): void {
    this.listeners.abort();
    this.root.replaceChildren();
  }

  render(model: HudModel): void {
    html(
      this.root,
      [
        this.turnBlock(model),
        model.phase === 'deploying' ? this.deployBlock(model) : this.actionBlock(model),
        this.selectedBlock(model),
        this.logBlock(model),
      ].join(''),
    );
  }

  private turnBlock(model: HudModel): string {
    const label = model.phase === 'deploying' ? '배치' : `${model.round}라운드`;
    return `<div class="hud-block">
      <div class="turn-banner">
        <div>
          <div class="who ${model.viewer}">플레이어 ${model.viewer}</div>
          <div class="muted" style="font-size:12px">${label} · 생존 A ${model.aliveA} / B ${model.aliveB}</div>
        </div>
        ${
          model.phase === 'battle'
            ? `<div style="text-align:right">
                 <div class="ap">${model.ap}<small>/ ${model.apMax}</small></div>
                 <div class="muted" style="font-size:11px">다음 턴 +${formatCarry(model.carryTenths)}</div>
               </div>`
            : ''
        }
      </div>
      ${model.suddenDeath ? '<div class="notice" style="margin-top:10px">서든데스 — 매 턴 전 기물 HP −2</div>' : ''}
    </div>`;
  }

  private deployBlock(model: HudModel): string {
    return `<div class="hud-block">
      <h3 style="font-size:14px">기물 배치</h3>
      <p class="muted" style="margin:6px 0 12px;font-size:13px">
        파란 구역 안을 클릭해 기물을 놓습니다. 놓인 기물을 다시 클릭하면 회수합니다.
        상대 배치는 양측이 제출을 마칠 때까지 보이지 않습니다.
      </p>
      <div class="row" style="justify-content:space-between">
        <span class="muted">남은 기물 <strong class="mono">${model.deployRemaining}</strong></span>
        <button data-act="submit-deploy" class="primary" ${model.deployRemaining > 0 ? 'disabled' : ''}>배치 제출</button>
      </div>
    </div>`;
  }

  private actionBlock(model: HudModel): string {
    return `<div class="hud-block">
      <div class="row" style="justify-content:space-between">
        <button data-act="focus" ${model.canFocus ? '' : 'disabled'}>집중 (1 AP · SP +3)</button>
        <button data-act="end-turn" class="primary">턴 종료</button>
      </div>
      <button data-act="exit" class="ghost" style="width:100%;margin-top:8px;font-size:12px">매치 나가기</button>
    </div>`;
  }

  private selectedBlock(model: HudModel): string {
    const piece = model.selected;
    if (!piece) {
      return `<div class="hud-block"><p class="muted" style="margin:0">기물을 선택하세요.</p></div>`;
    }

    const base = requireBase(piece.baseId);
    const hpPercent = (piece.hp / piece.maxHp) * 100;
    const spPercent = piece.maxSp === 0 ? 0 : (piece.sp / piece.maxSp) * 100;

    const skillButtons = model.usableSkills
      .map(
        (skill) => `<button data-skill="${esc(skill.id)}" class="${model.activeSkillId === skill.id ? 'active' : ''}">
          <span>${esc(skill.name)} <span class="muted">${skill.minDamage}~${skill.maxDamage}</span></span>
          <span class="cost">사거리 ${skill.range} · SP ${skill.spCost}</span>
        </button>`,
      )
      .join('');

    const locked = model.lockedSkill
      ? `<button disabled>
           <span>${esc(model.lockedSkill.name)} <span class="muted">잠김</span></span>
           <span class="cost">SP ${piece.sp}/${model.lockedSkill.spCost}</span>
         </button>`
      : '';

    const preview = model.preview
      ? `<div class="notice" style="margin-top:10px;border-color:var(--accent);background:rgba(110,168,254,.1);color:#cfe0ff">
           ${esc(model.preview.targetName)} · 거리 ${model.preview.distance} ·
           예상 <strong class="mono">${model.preview.range.min}~${model.preview.range.max}</strong>
         </div>`
      : '';

    return `<div class="hud-block">
      <div class="row" style="justify-content:space-between">
        <strong>${esc(baseName(piece.baseId))}</strong>
        <span class="tag">${esc(base.moveLabel)}</span>
      </div>

      <div style="margin-top:10px">
        <div class="row" style="justify-content:space-between;font-size:12px">
          <span class="muted">HP</span><span class="mono">${piece.hp} / ${piece.maxHp}</span>
        </div>
        <div class="meter hp"><i style="width:${hpPercent}%"></i></div>
        <div class="row" style="justify-content:space-between;font-size:12px">
          <span class="muted">SP</span><span class="mono">${piece.sp} / ${piece.maxSp}</span>
        </div>
        <div class="meter sp"><i style="width:${spPercent}%"></i></div>
      </div>

      <div class="stat-grid">
        <div><span>공격력</span><span>${piece.atk}</span></div>
        <div><span>회피</span><span>${piece.baseEva}%</span></div>
        <div><span>속도</span><span>${piece.spd}</span></div>
        <div><span>편성 스킬</span><span>${esc(skillName(piece.skillId))}</span></div>
      </div>

      ${
        piece.statuses.length > 0
          ? `<div style="margin-top:8px">${piece.statuses
              .map((s) => `<span class="tag" style="color:#c084fc">회피 −${s.value} (${s.turnsLeft}턴)</span>`)
              .join(' ')}</div>`
          : ''
      }

      ${model.phase === 'battle' ? `<div class="skill-buttons">${skillButtons}${locked}</div>${preview}` : ''}
    </div>`;
  }

  private logBlock(model: HudModel): string {
    return `<div class="hud-block">
      <h3 style="font-size:13px;color:var(--text-dim);font-weight:500">전투 기록</h3>
      <div class="log">
        ${model.log
          .slice(-60)
          .map(
            (entry) =>
              `<div class="${entry.highlight ? 'hi' : ''} ${entry.owner ? entry.owner.toLowerCase() : ''}">${esc(entry.text)}</div>`,
          )
          .join('')}
      </div>
    </div>`;
  }
}
