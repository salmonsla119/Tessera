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
| **M3** | 서버(`apps/server`) · 인증 · 매칭 · 비동기 매치 · 클라이언트 연동(`RemoteBackend`) | 완료 |
| **M4** | 밸런싱 · 연출 · 사운드 · 알림 | 미착수 |

메뉴에서 세 가지로 대전할 수 있다: **로컬 핫시트**(한 브라우저에서 양측 플레이), **AI와 대전**(하/중/상 난이도, 매칭 없이 즉시 시작), **온라인 비동기 대전**(로그인 → 매칭 큐 → 서버 권위 판정, `apps/server` 필요). 온라인 대전은 빌드 시 `VITE_API_BASE_URL`이 설정돼 있어야 활성화된다 — 비어 있으면 조용히 꺼진 채로 로컬/AI 대전만 남는다.

---

## 구조

```
packages/data/     bases.json · skills.json + zod 스키마 + 예산 검증 + 밸런스 상수
packages/rules/    순수 TS 규칙 엔진 (외부 의존성 0) + Vitest + 헤드리스 시뮬레이터
apps/web/          Phaser 3 + Vite 클라이언트
apps/server/       Cloudflare Workers + Hono + D1 + Durable Objects (M3, PLAN §4·§5)
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

모든 메서드가 비동기라 덱 CRUD·액션 제출 호출부는 원격 구현으로 바꿔도 그대로다. 다만 `MatchController`(`match.ts`)는 원래 "한 화면에 앉은 사람이 배치 순서·턴에 따라 바뀐다"는 핫시트 전제로 짜여 있어, 실제로 붙여 보니 그 전제 자체를 손볼 필요가 있었다 — 온라인/AI에서는 이 컨트롤러가 **항상 같은 한쪽만** 대변해야 하기 때문이다. 그래서 `MatchOptions`에 `fixedViewer`(고정 시점 — 상대 턴엔 조작 막고 자리 교대 모달도 생략), `autoPlayer`(AI가 반대쪽을 대신 두는 훅), `pollMs`(온라인에서 상대 수를 주기적으로 확인)를 추가했다. 지정하지 않으면 기존 핫시트 동작 그대로다.

원격 구현이 반드시 지켜야 하는 것 (PLAN §4.2):

1. 클라이언트가 보낸 액션을 서버에서 `checkAction`으로 **재검증한 뒤에만** `applyAction`한다.
2. **모든 주사위는 서버가 굴린다.** 클라이언트가 보낸 굴림 결과는 무조건 무시한다.
3. 배치 공개 전에는 상대 덱 구성과 좌표를 **응답에서 제거**한다. 보내놓고 UI에서 가리면 개발자 도구로 뚫린다. 마스킹 규칙의 참고 구현은 `backend/types.ts`의 `maskState()`에 있다.
4. 액션 로그는 append-only로 쌓고, 상태 = `초기 상태 + 로그 리플레이`로 재구성한다. 엔진이 결정론적이라 이게 성립한다 (테스트로 보장).

`LocalBackend`는 덱과 진행 중인 매치를 `localStorage`에 저장하므로, 새로고침해도 판이 이어진다.

### `apps/server` — 위 계약을 지키는 원격 구현 (M3)

Cloudflare Workers + Hono + D1(SQLite) + Durable Objects로 구현했다. 왜 이 스택인지, 매칭 큐를 왜 DB 대신 단일 Durable Object로 두었는지는 [PLAN.md §1](docs/PLAN.md)·[§5.3](docs/PLAN.md)에 있다.

```bash
pnpm --filter @tessera/server test         # vitest-pool-workers — 실제 D1 + Durable Object로 통합 테스트
pnpm --filter @tessera/server dev          # wrangler dev (로컬)
pnpm --filter @tessera/server deploy       # wrangler deploy
```

`apps/web/src/online/`에 이 서버에 붙는 `RemoteBackend`(위 `Backend` 구현)와 `api.ts`(fetch 래퍼)가 있고, `ui/auth.ts`·`ui/lobby.ts`가 로그인·덱·매칭 큐·진행 중인 매치 목록 화면을 맡는다. GitHub Pages(클라이언트)와 Workers(서버)는 서로 다른 사이트라 세션 쿠키는 `SameSite=None; Secure`로 발급한다.

### AI 대전

`apps/web/src/ai/policy.ts`에 난이도별 정책이 있다 — 하(완전 무작위) · 중(기대 데미지 최댓값 공격, 없으면 최근접 적에게 접근) · 상(마무리 공격 최우선, 빈사 아군은 사거리 밖으로 후퇴 시도). 서버 없이 `packages/rules`를 브라우저에서 그대로 돌리는 `AiMatchBackend`(메모리 전용 — 새로고침하면 끝나는 캐주얼 대전) 위에서, `MatchController`의 `autoPlayer` 훅이 상대 턴마다 정책을 호출해 자동으로 둔다.

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
