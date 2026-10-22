# 적대적 검토 R1 — 커밋 d3dc372 "full-stack implementation (23/23 tasks)"

검토일: 2026-10-22 · 방법: 타입체크/테스트 실행 + 데이터 계층 코드 정독

## 결론
23개 Task 완료 표시는 **증거로 뒷받침되지 않음**. 대부분의 화면이 데모 데이터에 고정돼 있고,
보안 회귀와 테넌트 간 데이터 노출이 있어 Task 1부터 재검증·재구현이 필요하다.

## 발견 사항

| # | 심각도 | 위치 | 내용 |
|---|---|---|---|
| 1 | CRITICAL | apps/web/package.json | `next@15.1.3` (CVE-2025-29927 미들웨어 우회, CVE-2025-55182 RSC RCE) · `next-auth@5.0.0-beta.25`로 다운그레이드 |
| 2 | CRITICAL | lib/data.ts `getPrompts`, `getCompetitorList` | websiteId 필터 없음 → 모든 조직의 프롬프트/경쟁사 노출 |
| 3 | HIGH | lib/auth.ts dev 로그인 | DB 실패 시 `id: email`로 세션 발급(무결성 붕괴), 조직 생성 없음 |
| 4 | HIGH | 미들웨어 부재 | 페이지/API 보호가 각 페이지 호출에만 의존 |
| 5 | HIGH | lib/data.ts `getResponses`, `getDashboardData` | DB에 데이터가 있어도 항상 데모 데이터 반환 (Task 7·8 미구현) |
| 6 | HIGH | lib/data.ts `getWorkspace`, (app)/layout | DB 오류 시 가짜 워크스페이스(Canvasly)로 조용히 대체 → 장애 은폐 |
| 7 | MEDIUM | components/sidebar.tsx | 스위처가 항상 사이트 1개, `?ws=` 파라미터를 아무도 읽지 않음 |
| 8 | MEDIUM | packages/db | PGlite devDep·`./testing` export 제거로 typecheck 실패 (core, db) |
| 9 | MEDIUM | packages/db/src/seed.ts | TS1355 컴파일 오류 |

## 조치
- Tasks.md 체크를 "검증 완료" 기준으로 되돌림 (검증 근거는 각 라운드 리뷰 문서에 기록).
- R1 수정 범위: #1~#4, #6~#9 + #2 범위 쿼리. #5는 Task 7·8 라운드에서 실데이터로 재구현.

## R1 조치 결과 (검증 증거)

| # | 상태 | 증거 |
|---|---|---|
| 1 | 수정 | next 15.5.28 · next-auth 5.0.0-beta.32 · `next build` 성공 |
| 2 | 수정 | `getPrompts(websiteId)`/`getCompetitorList(websiteId)` 범위 쿼리 — 2테넌트 스모크: 타 테넌트 프롬프트 0건 노출 |
| 3 | 수정 | dev 로그인은 `ensureUserWithOrg` 실패 시 세션 미발급(잘못된 이메일 → error=Configuration), NODE_ENV=production에서 비활성 |
| 4 | 수정 | `src/middleware.ts` — 미인증 페이지 302 → `/login?redirect=`, 비공개 API 401 (unit: `isPublicPath`, `safeRedirect`) |
| 5 | 이월 | Task 7·8 라운드 |
| 6 | 수정 | `requireWorkspace()` — 가짜 워크스페이스 제거, 사이트 없으면 `/onboarding` 307, 위조 쿠키 무시 |
| 7 | 수정 | 스위처가 접근 가능한 전체 사이트 표시, 서버 액션에서 멤버십 재검증 후 쿠키 설정 |
| 8 | 수정 | `@athena/db/testing`(PGlite) 복원, tenancy 테스트 6/6 |
| 9 | 수정 | seed.ts 컴파일 오류 제거 |

추가 발견(이월): 온보딩 마법사가 아무것도 저장하지 않음(Task 3), `/api/onboarding/probe` 서버측 임의 URL fetch → SSRF 위험(Task 3), Ask Athena/Discover가 데모 데이터 기반(Task 4·11).
