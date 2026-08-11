# Tessera

8×8 격자 위의 턴제 덱빌딩 그리드 전술 게임. 제한된 코스트로 기물 덱을 짜고, **팀 공용 행동력**을 배분해 상대 기물을 전멸시킨다.

- 규칙: [docs/GDD.md](docs/GDD.md)
- 구현 계획: [docs/PLAN.md](docs/PLAN.md)
- 플레이: **https://salmonsla119.github.io/Tessera/**

---

## 현재 범위

| | 내용 | 상태 |
|---|---|---|
| **M0** | `packages/rules` + `packages/data` — 규칙 엔진, 헤드리스 시뮬레이터 | 완료 |
| **M1** | Phaser 로컬 핫시트 (한 브라우저에서 양측 플레이) | 완료 |
| **M2** | 덱빌더 UI + 코스트 검증 | 완료 |
| **M3** | 서버 · 인증 · 매칭 · 비동기 매치 | **미착수 — 백엔드 연결 예정** |
| **M4** | 밸런싱 · 연출 · 사운드 · 알림 | 미착수 |

온라인 대전 메뉴는 화면에 있지만 비활성이다. 지금 동작하는 것은 로컬 핫시트 한 판이다.

---

## 구조

```
packages/data/     bases.json · skills.json + zod 스키마 + 예산 검증 + 밸런스 상수
packages/rules/    순수 TS 규칙 엔진 (외부 의존성 0) + Vitest + 헤드리스 시뮬레이터
apps/web/          Phaser 3 + Vite 클라이언트
docs/              GDD.md · PLAN.md
```

규칙 엔진은 `Phaser`·`document`·`fetch`를 import하지 않는다. 클라이언트와 (앞으로의) 서버가 **같은 코드**로 판정하므로 예상 데미지 미리보기가 서버 계산과 어긋나지 않는다.

```ts
createMatch(deckA, deckB, seed): MatchState
legalActions(state, playerId): Action[]
checkAction(state, action): { ok, reason? }
applyAction(state, action): { state, events }
```

`applyAction`은 상태를 변형하지 않고 **연출용 이벤트 배열**을 함께 돌려준다. Phaser는 이 이벤트만 보고 그린다 — 씬 안에서 규칙을 다시 계산하지 않는다.

---

## 명령

```bash
pnpm install

pnpm dev          # 개발 서버
pnpm build        # apps/web/dist 생성
pnpm test         # 규칙 엔진 테스트 63개
pnpm typecheck    # 전 패키지 타입 검사
pnpm sim -- --games 1000   # 헤드리스 자동 대전
```

---

## 백엔드를 붙일 자리

클라이언트는 `apps/web/src/backend/types.ts`의 `Backend` 인터페이스 하나만 바라본다. 지금은 규칙 엔진을 브라우저에서 그대로 돌리는 `LocalBackend`(핫시트용)가 유일한 구현이다.

```ts
interface Backend {
  listDecks / saveDeck / deleteDeck
  createMatch(deckA, deckB): Promise<MatchView>
  getMatch(matchId): Promise<MatchView | null>
  submitAction(matchId, action): Promise<MatchView>
  abandonMatch(matchId): Promise<void>
}
```

모든 메서드가 비동기라 원격 구현을 끼워 넣을 때 **호출부(`app.ts`, `match.ts`)를 고칠 필요가 없다.**

원격 구현이 반드시 지켜야 하는 것 (PLAN §4.2):

1. 클라이언트가 보낸 액션을 서버에서 `checkAction`으로 **재검증한 뒤에만** `applyAction`한다.
2. **모든 주사위는 서버가 굴린다.** 클라이언트가 보낸 굴림 결과는 무조건 무시한다.
3. 배치 공개 전에는 상대 덱 구성과 좌표를 **응답에서 제거**한다. 보내놓고 UI에서 가리면 개발자 도구로 뚫린다. 마스킹 규칙의 참고 구현은 `backend/types.ts`의 `maskState()`에 있다.
4. 액션 로그는 append-only로 쌓고, 상태 = `초기 상태 + 로그 리플레이`로 재구성한다. 엔진이 결정론적이라 이게 성립한다 (테스트로 보장).

`LocalBackend`는 덱과 진행 중인 매치를 `localStorage`에 저장하므로, 새로고침해도 판이 이어진다.

---

## GDD에서 미확정이던 것을 구현하며 정한 규칙

기획서에 명시가 없어 한쪽으로 정해야 했던 것들이다. 전부 한 곳만 고치면 뒤집을 수 있다.

| 항목 | 정한 값 | 근거 / 바꾸는 곳 |
|---|---|---|
| 상태이상 지속 턴 기준 (GDD §9) | **대상 턴 기준** — 대상 플레이어의 턴 시작마다 1 감소 | `rules/src/resolve.ts` `startTurn()` |
| 장군의 "전방향 최대 3칸" 이동 | **경로 차단되는 8방향 3칸** (퀸형). GDD §5 서두가 "이동은 체스 규칙을 따른다"라고 못박아 §6의 `전방향`(경로 무시)과 다르게 읽었다 | `data/src/bases.json`의 `move.kind`를 `area`로 바꾸면 경로 무시가 된다 |
| 회피 시 부가 효과 | **적용하지 않음** — 완전 회피는 공격이 빗나간 것으로 본다 | `rules/src/resolve.ts` `resolveAttack()` |
| 회피 상한 적용 순서 | 상태이상 보정을 **모두 더한 뒤** 0~60%로 자른다 | `rules/src/state.ts` `effectiveEva()` |
| 서든데스 기준 "40턴" | **40라운드**(양측 1턴씩 = 1라운드) 초과부터 | `data/src/constants.ts` `SUDDEN_DEATH_ROUND` |
| AP 소진 시 | **턴이 자동으로 넘어간다** (GDD §8.1 "AP를 모두 쓰거나") | `rules/src/resolve.ts` `autoEndTurn()` |
| 상태이상 중첩 | 같은 효과가 여러 번 걸리면 **누적** (합산 후 상한 적용) | `rules/src/resolve.ts` |

AP 이월은 0.1을 실수로 더하는 대신 **1/10 단위 정수**로 누적한다. 100턴을 굴려도 오차가 없다는 것을 테스트로 고정해 뒀다.

---

## 검증 현황

```
pnpm test    →  63 tests passed
```

PLAN §8.1의 검증 표를 그대로 옮겼다: AP 이월 골든(GDD §2.3 표와 일치) · AP 불변성 · 데미지 파이프라인(ATK 5 + 관통사격 → 거리1 `7~12`, 거리3 `5~8`) · 이동 경로 차단과 L자 도약 · 회피 상한 60% · 결정론 리플레이 · 덱 코스트 거부 규칙.

헤드리스 자동 대전 1000판 (`pnpm sim -- --games 1000`):

```
평균 라운드        5.5
선공 승률          50.2%   (목표 45~55%)
강제 종료율        0.0%
AP 몰빵 승리 비율  4.5%
```

선공 승률과 무한 루프는 목표 안에 들어왔다. **다만 평균 5.5라운드는 PLAN §9-4가 상정한 30라운드보다 훨씬 짧다.** 기준선 AI가 카이팅 없이 최단거리로 붙기만 하는 탐욕적 정책이라 하한값에 가깝지만, HP 대비 데미지가 높다는 신호이기도 하다. M4 밸런싱에서 AI를 개선한 뒤 다시 재야 할 숫자다.

브라우저 E2E는 Playwright로 메뉴 → 덱빌더 예산 검증 → 배치(양측 가림막) → 선택/이동/공격 미리보기/확정 → 턴 교대까지 확인했다.
