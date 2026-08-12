import { $, delegate, esc, html } from './dom';

export interface AuthHandlers {
  onLogin: (username: string, password: string) => void;
  onSignup: (username: string, password: string) => void;
  onCancel: () => void;
}

export function renderAuth(container: HTMLElement, error: string | null, handlers: AuthHandlers): void {
  html(
    container,
    `<div class="screen" style="max-width:420px">
      <div class="screen-head">
        <div>
          <h1>온라인 대전 로그인</h1>
          <p>계정으로 덱을 저장하고 다른 사람과 비동기로 대전합니다.</p>
        </div>
      </div>
      <div class="panel" style="display:grid;gap:12px">
        <label style="display:grid;gap:4px">
          <span class="muted" style="font-size:12px">아이디 (영문/숫자/밑줄, 3자 이상)</span>
          <input type="text" id="username" autocomplete="username" />
        </label>
        <label style="display:grid;gap:4px">
          <span class="muted" style="font-size:12px">비밀번호 (8자 이상)</span>
          <input type="password" id="password" autocomplete="current-password" />
        </label>
        ${error ? `<div class="notice" style="border-left-color:var(--danger);color:#ffb4b4">${esc(error)}</div>` : ''}
        <div class="row" style="justify-content:space-between;margin-top:4px">
          <button data-act="cancel" class="ghost">메뉴로</button>
          <div class="row">
            <button data-act="signup">회원가입</button>
            <button data-act="login" class="primary">로그인</button>
          </div>
        </div>
      </div>
    </div>`,
  );

  const read = () => ({
    username: $<HTMLInputElement>(container, '#username').value.trim(),
    password: $<HTMLInputElement>(container, '#password').value,
  });

  delegate(container, 'button[data-act]', (button) => {
    const { username, password } = read();
    switch (button.dataset.act) {
      case 'login':
        handlers.onLogin(username, password);
        break;
      case 'signup':
        handlers.onSignup(username, password);
        break;
      case 'cancel':
        handlers.onCancel();
        break;
    }
  });
}
