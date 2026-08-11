import { $, esc, html } from './dom';

export interface ModalAction {
  label: string;
  value: string;
  primary?: boolean;
}

const root = () => document.getElementById('modal') as HTMLElement;

/** 버튼 하나가 눌릴 때까지 기다렸다가 그 value를 돌려준다. */
export function showModal(options: {
  title: string;
  body?: string;
  actions: ModalAction[];
}): Promise<string> {
  const node = root();
  html(
    node,
    `<div class="modal-card">
      <h2>${esc(options.title)}</h2>
      ${options.body ? `<p>${options.body}</p>` : ''}
      <div class="row">
        ${options.actions
          .map(
            (a) =>
              `<button data-value="${esc(a.value)}" class="${a.primary ? 'primary' : ''}">${esc(a.label)}</button>`,
          )
          .join('')}
      </div>
    </div>`,
  );
  node.hidden = false;

  return new Promise((resolve) => {
    const card = $(node, '.modal-card');
    card.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('button[data-value]');
      if (!button) return;
      node.hidden = true;
      resolve(button.dataset.value!);
    });
  });
}

export function hideModal(): void {
  root().hidden = true;
}
