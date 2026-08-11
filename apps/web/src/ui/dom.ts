/** 사용자가 입력한 덱 이름 등이 마크업으로 해석되지 않게 막는다. */
export function esc(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );
}

export function html(target: HTMLElement, markup: string): void {
  target.innerHTML = markup;
}

export function $<T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`요소를 찾을 수 없습니다: ${selector}`);
  return found;
}

export function $$<T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

/**
 * 이벤트 위임 — 안쪽 목록을 다시 그려도 핸들러를 새로 붙이지 않아도 된다.
 *
 * 같은 루트에 두 번 붙이면 클릭이 두 번 처리되므로, 루트를 재사용하는 쪽에서는
 * `signal`을 넘겨 이전 등록을 반드시 끊어야 한다.
 */
export function delegate(
  root: HTMLElement,
  selector: string,
  handler: (element: HTMLElement, event: Event) => void,
  signal?: AbortSignal,
): void {
  root.addEventListener(
    'click',
    (event) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(selector);
      if (target && root.contains(target)) handler(target, event);
    },
    { signal },
  );
}

/** 화면 하나가 통째로 소유하는 새 컨테이너. 갈아 끼우면 안에 붙은 리스너도 함께 사라진다. */
export function mount(host: HTMLElement): HTMLElement {
  host.replaceChildren();
  const node = document.createElement('div');
  host.appendChild(node);
  return node;
}

export function uid(prefix = 'id'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}
