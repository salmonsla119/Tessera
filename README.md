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
| 빙결 지속 턴 | `frostbite`는 1턴이 아니라 **2턴**으로 설계 | 공격이 상대 AP를 소진시켜 `autoEndTurn`으로 곧장 대상의 `startTurn()`이 이어지면, "대상 턴 기준 감소"(위 규칙) 때문에 그 자리에서 1턴이 즉시 소모돼 1턴짜리 빙결은 실질 0턴이 된다. 2턴으로 보정해 최소 1턴은 보장 — `data/src/skills.json`의 `frostbite.effect.turns` |
| 지형 생성과 배치 구역 | 배치 구역(rank 1~2, 7~8)도 지형 생성 후보에 **포함** — 배치 시점부터 지형을 고려해 자리를 고르는 것도 전략의 일부로 본다 (초기에는 선제 불이익을 막으려 제외했다가, 이후 요청으로 되돌림) | `rules/src/terrain.ts` `generateTerrain()`. 테스트용 `startedMatch()` 헬퍼는 지형과 무관한 테스트에서 노이즈가 안 끼도록 지형을 항상 걷어낸다 |
| 숲의 회피 보너스 | 상태이상으로 부여하지 않고 **그 칸에 서 있는 동안만 실시간 계산** | 이동하면 즉시 사라져야 하므로 스택형 상태이상과 다르게 취급 — `rules/src/state.ts` `effectiveEva()` |
| 오라 패시브(치유/버프) | 상태이상으로 저장하지 않고 **매 시점 실시간으로 재계산** | 오라 제공자가 죽거나 범위를 벗어나면 그 즉시 사라져야 함 — `rules/src/passives.ts` |
| 지형 3종 동시 등장 시 크기 배분 | **먼저 자리 잡는 지형이 우선** — 전역 점유 칸을 공유해 서로 겹치지 않게 하고, 남은 칸이 부족한 지형은 목표(13~30칸)보다 작게, 자리가 없으면 등장 자체를 건너뛴다 | 보드 전체가 64칸뿐이라 3종×30칸(=90칸)을 동시에 다 채우는 게 산수상 당연히 불가능함 — `rules/src/terrain.ts` `generateTerrain()` |
| 범위 공격의 사거리 제약 | 스플래시(범위 공격)는 **항상 사거리 1(근접)에서만** 허용 — 사거리가 먼 범위 공격은 만들지 않는다 | 원거리 안전성과 범위 화력을 동시에 갖는 스킬이 나오면 밸런스가 무너짐 — `rules/src/__tests__/skill-taxonomy.test.ts`가 이 불변식을 테스트로 고정 |
| 방어 스킬의 회피 버프 방식 | 새 상태이상 `evaUp`을 `evaDown`의 반대 방향으로 추가 — 별도 "실드/피해감소" 수치 대신 기존 회피 스탯을 그대로 활용 | 기물에 새 방어 스탯(실드량 등)을 얹지 않고 기존 회피·상태이상 파이프라인을 그대로 재사용할 수 있음 — `rules/src/state.ts` `effectiveEva()` |
| 방어 스킬의 굴림 방식 | `defense` 스킬도 `heal`과 동일하게 `previewHeal`/`resolveHeal`을 그대로 재사용(ATK·거리 감쇠·회피 판정 없음) — 굴린 값이 곧 회피 버프량, `buffTurns` 필드가 지속 턴 | 힐과 방어 모두 "굴려서 아군에게 얼마나 좋은 효과를 주는가"라는 동일한 형태라 함수를 분리할 이유가 없음 — `rules/src/resolve.ts` `resolveDefenseUse()` |
| 방어 스킬과 AI | 현재 AI(`sim.ts`, `ai/policy.ts`)는 방어 스킬을 기대 데미지 계산에서 **제외**하고 아직 능동적으로 쓰지 않는다 | 방어는 아군 대상이라 기존 데미지 기대값 계산식이 그대로 안 맞음 — 추후 AI가 방어를 언제 쓸지는 별도 개선 과제로 남김 |
| 등급 시스템 소급 여부 | 기존 15종 베이스·16종 스킬은 등급 태깅만 하고 **스탯은 그대로 유지** — "등급 높을수록 좋다" 원칙은 신규 5종 베이스·5종 스킬에만 적용 | 직전에 막 끝낸 밸런싱 결과를 등급 시스템 도입으로 다시 흔들지 않기 위함 — `data/src/bases.json`/`skills.json` |
| 가챠 게이트의 기준 | 자기 등급이 아니라 **시작 지급 목록(★) 포함 여부**로 보유 여부를 가른다 — 등급이 일반이어도 시작 4+4종이 아니면 가챠로 뽑아야 함 | "등급=희소성"과 "시작 지급=접근성"을 분리해서, 이후 일반 등급 콘텐츠를 더 추가해도 시작 덱 구성이 자동으로 늘어나지 않게 함 — `data/src/index.ts` `STARTER_BASE_IDS`/`STARTER_SKILL_IDS` |
| 가챠 뽑기 단위 | 항목(베이스/스킬) 하나하나가 뽑기 대상 — 타입 50/50 → 등급 가중치(일반70/희귀25/전설5) → 그 안에서 균등 무작위 | 별도 배너·픽업 개념 없이 가장 단순한 형태로 시작. `server/src/gacha.ts` `rollGachaItem()` |
| 보유 판정을 단일 표로 통일 | 시작 지급 4베이스/4스킬도 예외 취급하지 않고 계정 생성 시점에 `inventory` 표에 그대로 INSERT | "보유 여부"를 확인하는 모든 코드(덱 검증, 인벤토리 조회)가 시작 지급 여부를 따로 분기하지 않아도 됨 — `server/src/db.ts` `grantStarterAccount()` |
| 로컬/AI 매치 보상의 신뢰 경계 | 온라인 매치(`mode: 'online'`)는 실제 매치 참가·종료 여부를 서버가 검증하지만, 로컬/AI 핫싯(`mode: 'local'\|'ai'`)은 서버에 매치 기록 자체가 없어 **같은 청구 키의 중복 지급만 막을 뿐, 클라이언트가 매번 새 키로 반복 청구하는 것은 막지 못한다** | 로컬/AI 매치는 애초에 서버를 거치지 않고 브라우저에서만 진행되므로(§ "AI 대전" 참고) 서버가 검증할 근거가 없음 — 실물 재화가 아닌 내부 게임 재화라 당장은 감수할 만한 트레이드오프로 판단, 악용이 문제 되면 클라이언트에 매치당 1회 청구를 강제하는 UX 제약을 추가하는 쪽으로 보완 예정 — `server/src/routes/gacha.ts` |

AP 이월은 0.1을 실수로 더하는 대신 **1/10 단위 정수**로 누적한다. 100턴을 굴려도 오차가 없다는 것을 테스트로 고정해 뒀다.

---

## 검증 현황

```
pnpm test    →  115 tests passed   (rules 101 + server 14)
```

PLAN §8.1의 검증 표를 그대로 옮겼다: AP 이월 골든(GDD §2.3 표와 일치) · AP 불변성 · 데미지 파이프라인(ATK 5 + 관통사격 → 거리1 `7~12`, 거리3 `5~8`) · 이동 경로 차단과 L자 도약 · 회피 상한 60% · 결정론 리플레이 · 덱 코스트 거부 규칙.

지형·상태이상·패시브·회복 스킬(GDD §9~11)은 별도 테스트 스위트로 검증했다: 지형 생성 결정론·배치구역 미생성·이동 페널티(최소 1칸)·지형 면역 12건, 화상/출혈 DOT·빙결 봉쇄·상태 면역·회복 스킬(항상 적중, 최대치 클램프)·오라 패시브 9건.

헤드리스 자동 대전 1000판 (`pnpm sim -- --games 1000`):

```
평균 라운드        5.5
선공 승률          50.2%   (목표 45~55%)
강제 종료율        0.0%
AP 몰빵 승리 비율  4.5%
```

선공 승률과 무한 루프는 목표 안에 들어왔다. **다만 평균 5.5라운드는 PLAN §9-4가 상정한 30라운드보다 훨씬 짧다.** 기준선 AI가 카이팅 없이 최단거리로 붙기만 하는 탐욕적 정책이라 하한값에 가깝지만, HP 대비 데미지가 높다는 신호이기도 하다. M4 밸런싱에서 AI를 개선한 뒤 다시 재야 할 숫자다.

브라우저 E2E는 Playwright로 메뉴 → 덱빌더 예산 검증 → 배치(양측 가림막) → 선택/이동/공격 미리보기/확정 → 턴 교대까지 확인했다.

### 베이스 밸런싱 (신규 시스템 확장 이후)

지형·상태이상·범위 공격·방어 스킬이 다 붙은 뒤 `pnpm sim -- --games 800`으로 15종 베이스별 생존율을 다시 재봤다. 무작위 덱끼리 붙이는 기준선이라 절대값보다 **상대적으로 유독 낮은 베이스**를 잡아내는 용도로 쓴다.

```
berserker/templar/lancer/paladin/guard   28~34%   (상위권)
frostguard/swampstalker/ranger/mystic    21~25%   (중위권)
shaman/warlord/pyromancer/rider/assassin 15~19%   (중하위권)
acolyte                                  2~10%    (뚜렷한 하위 이탈)
```

등급 시스템 도입으로 5종을 더한 뒤 `pnpm sim -- --games 200`으로 재확인했다. 신규 5종(`aegisguard`/`reaver`/`warbringer`/`oracle`/`duskblade`)도 다른 베이스들과 비슷한 분포(15~26%대)로 섞여 들어가 극단적 우위/열세 없이 자리 잡았다.

`acolyte`(사제)와 `pyromancer`(화염술사)가 여러 판에 걸쳐 반복적으로 최하위권을 차지해 HP를 올렸다: `acolyte` 18→24, `pyromancer` 16→22 (그 외 스탯·코스트는 그대로). 재측정 결과 `pyromancer`는 5~11% → 17%로 뚜렷이 개선됐고, `acolyte`는 2~9% → 9~10%로 다소 개선됐지만 여전히 최하위다 — 공격력 3의 저화력 지원형이라는 설계 의도 자체가 원인이라 스탯 조정만으로는 한계가 있고, 향후 패시브 추가나 스킬 재구성이 필요할 수 있다는 걸 기록해 둔다. EVA를 15→20으로 더 올려 봤지만 생존율에 유의미한 변화가 없어(9.6%→9.8%) 되돌렸다 — 이 베이스의 약점은 회피가 아니라 다른 요인으로 보인다.

예시 덱 `지원 편성`은 `paladin`의 스킬을 `mend`(회복)에서 `barrier`(방어)로 바꿔, 아군 치유 오라 패시브·능동 회복·방어 버프·상태이상 부여를 한 덱 안에서 전부 보여주도록 재구성했다.
