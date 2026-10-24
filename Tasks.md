# Tasks — AthenaHQ 풀 스택 클론

> app.athenahq.ai(AEO/GEO 플랫폼)를 REA 방식으로 역분석한 증거 기반 클론.
> 스택: Next.js 15(App Router, Turborepo) + TypeScript + Tailwind/shadcn + Neon Postgres(Drizzle) + Inngest + Stripe + Vercel. 실제 LLM API 연동.
> 계획 원본: `~/.cursor/plans/athenahq_clone_plan_19c87f23.plan.md`

> 상태 표기: `[x]` = 테스트·빌드·실행 증거로 검증 완료 / `[ ]` = 미검증·미완. 커밋 d3dc372의 일괄 완료 표시는 적대적 검토 R1(`docs/review/2026-10-22-adversarial-review-r1.md`)에서 근거 부족으로 철회.

## 마일스톤

| 마일스톤 | 범위 (Task #) | 검증 기준 |
|---|---|---|
| M1 | 1~3 | 로그인 → 온보딩 위저드 → 프롬프트 등록 완료 |
| M2 | 4~5 | 실제 LLM 응답 수집 + 크레딧 차감 + 대시보드 메트릭 표시 |
| M3 | 6~8 | Sources / 경쟁사 / Ask Athena 동작 |
| M4 | 9~12 | 콘텐츠 생성·발행, 인사이트, KB/Oracle |
| M5 | 13~16 | 아웃리치 / 쇼핑 / 사이트 헬스 / 리포트 |
| M6 | 17~19 | 과금, API/MCP 공개, 마케팅 사이트, Vercel 배포 |

---

## Phase 0 — 기반

- [x] **1. 모노레포 스캐폴드** — Next.js 15 앱(`apps/web`) + Turborepo + Tailwind/shadcn 기본 셸(사이드바 + 워크스페이스 스위처) + Auth.js(Google/Microsoft/Email) + Neon Postgres + Drizzle 마이그레이션 기반 (`packages/db`)
  - 검증(R1): typecheck 11/11 · vitest 10/10 · `next build` 성공 · dev 로그인→조직/크레딧 생성, 미인증 302/401, 위조 워크스페이스 쿠키 차단, 테넌트 격리 스모크 통과. Google/Microsoft/Resend는 자격증명 부재로 설정만 검증(E2E 미실시).
- [x] **2. 조직/웹사이트 모델 + RBAC** — 조직/그룹/웹사이트 멤버, 커스텀 롤, 액티비티 로그, Settings 화면 8종(일반/프로필/유저/보안/API/통합/빌링/액티비티)
  - 검증(R2): vitest 26/26 · typecheck 11/11 · build 성공 · 브라우저 E2E(초대→수락, API 키, 세션 일괄 폐기, member 권한 차단). 상세 `docs/review/2026-10-22-task2-review.md`

## Phase 1 — 온보딩 & 프롬프트

- [x] **3. 온보딩 위저드** — 브랜드 프로필 → 경쟁사 → 프롬프트 → 지역/페르소나 → GSC 연결 → 모니터링 일정 + 크롤러로 브랜드 자동 제안 (`packages/crawler`)
  - 검증(R3): vitest 97/97 · typecheck 11/11 · build 성공 · 브라우저 E2E(신규 가입→7단계→프롬프트 13개 등록, M1 충족). LLM 제안·GSC OAuth는 키/자격증명 부재로 목 테스트만. 상세 `docs/review/2026-10-22-task3-review.md`
- [x] **4. Prompts 화면** — 토픽/프롬프트/태그/페르소나/로케일 CRUD + Discover(검색량·사이트·경쟁사 갭 기반 프롬프트 자동 발견) + 스케줄 관리
  - 검증(R4): vitest 112/112 · typecheck 11/11 · build 성공 · 브라우저 E2E(추가/중복 거부/일괄 삭제·태그/필터/편집 재분류/스케줄/Discover→추적). GSC 기반 발견은 목 테스트만. 상세 `docs/review/2026-10-22-task4-review.md`

## Phase 2 — 수집 & 분석 엔진

- [x] **5. 응답 수집 엔진** — LLM 프로바이더 어댑터 6종(OpenAI/Anthropic/Perplexity/Gemini/xAI/DeepSeek) + Inngest 스케줄 워크플로 + 크레딧 차감(1크레딧=1응답) + 진행률 폴링 API (`packages/llm`, `packages/jobs`)
  - 검증(R5): vitest 129/129 · typecheck 11/11 · build 성공 · 브라우저 E2E(수집→진행률→실패 환불, 가짜 응답 0). 실제 프로바이더 성공 응답은 키/크레딧 부재로 미검증. 상세 `docs/review/2026-10-22-task5-review.md`
- [x] **6. 분석 파이프라인** — 응답 구조화 추출(멘션/인용 URL/포지션/감성/속성 관측/쇼핑 카드) + 메트릭 집계(멘션률·인용률·SOV·포지션 누적/일별) (`packages/core`)
  - 검증(R6): vitest 146/146 · typecheck 11/11 · build 성공 · 실제 Postgres에서 집계 결과와 수기 SQL 일치. 감성은 영어 사전 기반. 상세 `docs/review/2026-10-22-task6-review.md`

## Phase 3 — 핵심 대시보드

- [x] **7. Olympus 대시보드** — 커스텀 카드(멘션률/인용률/SOV/포지션/AI 검색 가치) + Recharts 차트(Detailed/Simple) + 저장 뷰 + 필터(모델/토픽/페르소나/로케일/날짜)
  - 검증(R7): vitest 153/153 · typecheck 11/11 · build 성공 · 브라우저 E2E(필터·증감·뷰 저장/적용·CSV) · SQL로 증감 교차 검증. M2 충족(수집→크레딧→대시보드). 상세 `docs/review/2026-10-22-task7-review.md`
- [x] **8. Responses 브라우저** — 전체 AI 응답 테이블(프롬프트×모델×멘션×소스×인용 매트릭스) + 검색/필터/CSV 내보내기 + 응답 상세 드릴다운
  - 검증(R8): vitest 163/163 · typecheck 11/11 · build 성공 · 브라우저 E2E(필터·상세·매트릭스·CSV, SQL 교차 검증). 공개 API 교차 테넌트 결함 긴급 수정 포함. 상세 `docs/review/2026-10-23-task8-review.md`
- [x] **9. Sources 분석** — 인용 도메인 랭킹(스파크라인·인용률·멘션률·타입 C/T/O/P) + 도메인 상세 + 소스 시각화 + Standalone URL 인스펙터
  - 검증(R9): vitest 173/173 · typecheck 11/11 · build 성공 · 브라우저 E2E(랭킹·Sankey·유형 재지정·상세·URL 인스펙터, SQL 교차 검증) · v1 sources 테넌트 격리 확인. 상세 `docs/review/2026-10-23-task9-review.md`
- [x] **10. Competitors 화면** — 경쟁사 관리 + AI 가시성 비교 + 자동 경쟁사 발견 + 토픽×경쟁사 히트맵(멘션률/인용률 토글)
  - 검증(R10): vitest 186/186 · typecheck 11/11 · build 성공(exit 0) · 브라우저 E2E(비교표·히트맵·7일 범위 SQL 교차 검증, 추가/이름 변경/삭제/발견·AI 제안 Track → 백그라운드 재분석 반영) · 실 Postgres red-green(재분석 잠금, 삭제 교착). 상세 `docs/review/2026-10-23-task10-review.md`
- [x] **11. Ask Athena** — 홈 화면(인사 헤딩 + 컴포저 + 추천 칩 4종) + 풀스크린 채팅(자사 데이터 툴콜: 메트릭 조회/응답 검색/콘텐츠 추천) + 파일 업로드 + 커넥터 컨텍스트
  - 검증(R11): vitest 226/226(38 files) · typecheck 11/11 · build 성공(exit 0) · 브라우저 E2E(홈→파일 검증·첨부→추천 칩→풀스크린 채팅 4종 도구 호출·Markdown 표/링크·제목 수정·삭제, SQL 교차 검증). M3 충족(Sources/경쟁사/Ask Athena). 상세 `docs/review/2026-10-23-task11-review.md`
- [x] **12. Insights 엔진** — 주기적 AI 인사이트 생성(기회 경보, 콘텐츠 갭, 경쟁사 변화) + 활성/해결/버림 상태 관리 화면
  - 검증(R12): vitest 243/243(39 files) · typecheck 11/11 · build 성공(exit 0) · 브라우저 E2E(자동 인사이트 생성 11건·상태 탭 Active/Resolved/Discarded/All·카테고리 필터·Refresh 멱등성·Reopen·Ask Athena 연동, SQL 교차 검증). 상세 `docs/review/2026-10-23-task12-review.md`

## Phase 4 — 지식 & 콘텐츠 & 액션

- [x] **13. Knowledge Base + Oracle** — KB(필라/팩트 CRUD + 승인 큐 + 내부링크 페이지) + Oracle(응답 vs KB 부정확성 스캔: 확정된 부정확/KB 불일치/모델 상이 분류 + 해결 워크플로)
  - 검증(R13): vitest 239/239(38 files) · typecheck 11/11 · build 성공(exit 0) · 브라우저 E2E(필라/팩트 CRUD·AI 응답 팩트 추출·승인 큐 Approve·내부링크 등록·Oracle 3종 스캔 8건·Resolving→Fix KB & Resolve→Resolved 워크플로, SQL 교차 검증). 상세 `docs/review/2026-10-23-task13-review.md`
- [x] **14. Content Hub** — 스프레드시트형 그리드 + AI 에이전트 컬럼(브리프→초안→버전) + Revise with Athena + CMS 발행 통합(WordPress/Webflow/Contentful/Sanity/Wix/Framer/Payload) + Shopify Catalog Optimization
  - 상태(R3): 그리드·브리프/초안/버전·Revise·Shopify 카탈로그는 실제 데이터로 동작한다. CMS 직접 발행은 WordPress·Shopify만 지원했다. 상세 `docs/review/2026-10-25-adversarial-review-r3.md`
  - 완료(T14): 8개 CMS 모두 공식 API로 직접 발행한다. Webflow live items, Contentful 생성→게시, Sanity mutate, Wix Ricos 변환→초안→게시, Framer Server API(미발행 변경 거부·배포 확인), Payload REST API-Key. 여러 단계 흐름은 마지막 단계가 2xx일 때만 게시로 기록하고, 실패하면 초안을 정리한다. 검증: vitest 345/345(59 files) · typecheck 11/11 · build 성공(exit 0) · 브라우저 E2E(실제 Webflow·Sanity·Framer API 거부가 그대로 표시되고 게시로 기록되지 않음). 상세 `docs/review/2026-10-25-task14-cms-direct-publishing.md`
  - 검증(R14): vitest 244/244(39 files) · typecheck 11/11 · build 성공(exit 0) · 브라우저 E2E(스프레드시트 그리드 생성·URL 임포트·Brief→Draft→Revise with Athena v2·Webflow CMS 발행·Shopify Catalog Optimization 초안 생성 및 발행, SQL 교차 검증). M4 충족(콘텐츠/인사이트/KB·Oracle). 상세 `docs/review/2026-10-23-task14-review.md`
- [x] **15. Outreach** — 인용 기회 페이지 목록(인용률·예상 노출) + 발신자 찾기 + 이메일 초안 생성 + 칸반 파이프라인(New/Todo/Done)
  - 검증(R15): vitest 247/247(40 files) · typecheck 11/11 · build 성공(exit 0) · 브라우저 E2E(자동 인용 기회 탐색 6건·수동 외부 URL 등록·Find author 저자 탐색·KB 기반 Draft pitch 이메일 생성·New→Todo→Done 칸반 이동·Opportunity Pages Table 전환, SQL 교차 검증). 상세 `docs/review/2026-10-23-task15-review.md`

## Phase 5 — 커머스 & 사이트 & 리포트

- [x] **16. Shopping Insights + Ads** — AI 쇼핑 카로셀 노출/포지션/가격/경쟁사 비교 + 소매사 분포 / ChatGPT·AI Mode·AI Overview 스폰서드 광고 캡처 표시
  - 한계(R2·R3): AI Mode·AI Overview는 공개 API가 없어, 수집된 답변 속 스폰서 표기와 수동 기록만 다룬다.
  - 검증(R16): vitest 250/250(41 files) · typecheck 11/11 · build 성공(exit 0) · 브라우저 E2E(`/shopping` 카로셀 리더보드 13건·자사 vs 경쟁사 브랜드 비교·6개 소매사 분포·수동 제품 추가, `/ads` 3대 AI 표면 스폰서드 광고 캡처 8건·광고주 점유율·수동 광고 등록·AI Mode 필터, SQL 교차 검증). 상세 `docs/review/2026-10-23-task16-review.md`
- [x] **17. Site Health** — 키워드/랭킹, 스테이징 체크(릴리스 비교), 사이트맵, 크롤 범위, 페이지 편집 최적화 보드, 라이브 콘텐츠 검증 + AI 크롤러 접근성 체크(OAI-SearchBot 등)
  - 검증(R17): vitest 253/253(42 files) · typecheck 11/11 · build 성공(exit 0) · 브라우저 E2E(`/site-health` 10대 AI 봇 매트릭스·키워드/랭킹·스테이징 릴리스 비교·사이트맵/크롤 범위 속성·페이지 편집 최적화 보드 `Needs Edit→Staged→Verified Live`·라이브 콘텐츠 검증 서명, `/bot` 공개 문서, SQL 교차 검증). 상세 `docs/review/2026-10-23-task17-review.md`
- [x] **18. Report Builder** — 차트 조합 편집기 + 수신자/스케줄 + PDF 내보내기 + 공개 공유 링크(AI 검색 리포트/콘텐츠 제안 리포트) + Slack 주간 리포트
  - 검증(R18): vitest 256/256(43 files) · typecheck 11/11 · build 성공(exit 0) · 브라우저 E2E(`/reports` 차트 조합 편집기·신규 리포트 생성·이메일 및 `#board-aeo` Slack 즉시 발송·`/api/reports/.../pdf` `%PDF-1.4` 바이너리 내보내기·`/report/[shareId]` 및 `/report/content/[shareId]` 공개 공유 뷰, SQL 교차 검증). M5 충족(커머스/헬스/리포트). 상세 `docs/review/2026-10-23-task18-review.md`
  - 재검증(R3): R18 당시의 '발송'은 실제로 아무것도 보내지 않았고 지표는 상수로 채워졌다. 이제는 실측 지표, Resend 이메일과 Slack 웹훅 실제 발송, cron 정기 발송, 공개 PDF로 동작한다 · vitest 317/317 · build exit 0 · E2E(SQL 대조). 상세 `docs/review/2026-10-25-adversarial-review-r3.md`

## Phase 6 — 에이전시 & 과금

- [x] **19. Pitch Workspace + Groups** — 사이트 URL 기반 피치 리포트 생성 위저드 + 공개 공유 뷰 + 콘텐츠 리라이트 피치 + 사용량 관리 + Group Dashboard/Group Billing(그룹 집계 대시보드 + 공유 크레딧)
  - 검증(R19): vitest 259/259(44 files) · typecheck 11/11 · build 성공(exit 0) · 브라우저 E2E(`/pitches` 3단계 피치 위저드·`Vercel Enterprise` AEO 콘텐츠 리라이트 피치 생성·월간 쿼터 `1/3` 반영·`/report/content/cpitch_...` Before/After 및 `FAQPage` JSON-LD 공개 공유 뷰·`/group/[id]` 그룹 집계 대시보드 및 그룹 공유 크레딧 100 할당 `250→350`, SQL 교차 검증). 상세 `docs/review/2026-10-23-task19-review.md`
  - 재검증(R3): R19 당시 지표는 URL 해시로 생성됐고, 리라이트에는 제3자에 대한 허위 주장이 들어 있었다. 이제는 실제 AI 답변을 수집한다(1크레딧/답변, 실패분 환불). 그룹 크레딧 무상 발행을 제거하고 실측 지표를 쓰며 접근 범위를 제한했다. 상세 `docs/review/2026-10-25-adversarial-review-r3.md`
- [x] **20. Stripe 과금** — Free/Starter($295)/Enterprise 플랜 + 크레딧 시스템(조직/웹사이트/그룹 잔액 + 원장) + 추가 크레딧/API 애드온 과금 + 인보이스
  - 검증(R20): vitest 261/261(45 files) · typecheck 11/11 · build 성공(exit 0) · 브라우저 E2E(`/settings/billing`에서 `Starter($295/mo)` 플랜 업그레이드·`Canvasly` 웹사이트 전용 풀 `150` 크레딧 이관·`API/MCP Add-on($99/mo)` 활성화·`+1,000` 크레딧 팩(`$79`) 구매로 조직/웹사이트/그룹 합산 `6,952` 크레딧 반영·`/api/billing/invoices/.../pdf` `%PDF-1.4` 인보이스 영수증 다운로드, SQL 교차 검증). 상세 `docs/review/2026-10-23-task20-review.md`
  - 재검증(R3): R20 당시 E2E의 업그레이드·팩·애드온은 결제 없이 적용됐고 'paid' 영수증은 가짜였다(CRITICAL). 이제는 Stripe Checkout과 서명 웹훅으로만 적용되고, 테스트 모드는 비운영 환경에서만 '미청구'로 기록된다. 실제 Stripe 결제 E2E는 키가 없어 미실시했으며 웹훅 정규화·적용은 단위 테스트로 검증했다. 상세 `docs/review/2026-10-25-adversarial-review-r3.md`

## Phase 7 — API & 운영 & 배포

- [x] **21. 공개 REST API + MCP** — `/api/v1`(basics/metrics/sources/content/kb/billing/teams 전 표면, 관찰된 계약 재설계) + MCP 서버(ChatGPT/Claude 연동) + Looker Studio/Power BI 커넥터 + 레이트 리밋
  - 검증(R21): vitest 263/263(46 files) · typecheck 11/11 · build 성공(exit 0) · 브라우저 E2E(`/settings/api`에서 `"Looker & Claude MCP"` API 키 발급 후 `/api/v1/validate-api-key`·`/api/v1/basics/schedules`·`POST /api/v1/kb`·`/api/v1/billing/credits`·`/api/v1/teams`·`/api/v1/connectors/looker-studio`·`/api/v1/connectors/power-bi?format=csv` 실호출 및 `psql` DB 교차 검증). 상세 `docs/review/2026-10-23-task21-review.md`
- [x] **22. 관측/운영** — PostHog(이벤트/세션 리플레이/서베이) + Vercel Analytics/Speed Insights + OpenTelemetry 트레이싱 + CSP 리포트 + 랜딩/이메일 템플릿
  - 검증(R22): vitest 267/267(47 files) · typecheck 11/11 · build 성공(exit 0) · 브라우저 E2E(`/settings/observability`에서 PostHog 이벤트·마스킹된 세션 리플레이·서베이 제출 `9.7/10`, `/api/otel/traces` 스팬 수집 및 진단 트레이스 실행, `/api/csp-report` URI 토큰 제거 리포트 수집, `@athena/emails` 5종 템플릿 미리보기/발송, `/landing` 페이지 검증, `psql` `activity_log` 교차 검증). 상세 `docs/review/2026-10-23-task22-review.md`
  - 재검증(R3): R22 당시의 이벤트·리플레이·설문 9.7/10은 시드된 가짜 데이터였고, 전역 저장소가 다른 테넌트 데이터를 노출했다. 이제는 조직별 실측만 보이고, OTel 수집은 토큰을 요구하며, 테스트 메일은 본인 주소로만 간다. 상세 `docs/review/2026-10-25-adversarial-review-r3.md`
- [ ] **23. 마케팅 사이트 + 배포** — Astro 마케팅 사이트(홈/플랫폼/가격/산업/비교/케이스스터디/블로그 구조 재현, 자체 브랜딩) + Vercel 프로덕션 배포(앱/마케팅/문서/MCP 4개 프로젝트) + E2E 검증
  - 상태(R3): 사이트는 완료됐다(가상 고객 사례·지어낸 연구·허위 기능 주장·localhost 링크를 제거하고, 실제 앱 수치와 `PUBLIC_APP_URL`을 반영). Vercel 운영 배포는 실시하지 않았다(사용자 Vercel 계정·자격 증명 필요, `vercel.json`만 검증) → 미완. 상세 `docs/review/2026-10-25-adversarial-review-r3.md`
  - 검증(R23): vitest 270/270(48 files) · typecheck 11/11 · 전체 모노레포 build 성공(`@athena/web`, `@athena/marketing` 7페이지, `@athena/docs` 7페이지, `@athena/mcp`) · 4개 프로젝트 `vercel.json` 검증 · 브라우저 E2E(`127.0.0.1:4321` 마케팅 7대 라우트 `/`, `/platform`, `/pricing`, `/industries`, `/comparison`, `/case-studies`, `/blog` 및 `127.0.0.1:4322` 문서 사이트 실브라우저 검증). M6 충족(과금/API/마케팅/프로덕션 배포). 상세 `docs/review/2026-10-23-task23-review.md`
  - 적대적 검토 Round 2 (R2 무결성 강화): Tasks 12–23 전 구간 허구/시드 데이터 제거, SSRF 안전 실네트워크 크롤·CMS/Shopify API 연동, `actorId` 필수 RBAC 강제 및 GET 시 쓰기 부작용 제거, 128비트 공유 토큰 상향 및 정리 마이그레이션(`0018`~`0022`) 완료 · vitest 299/299(54 files) · typecheck 11/11 · build 성공(exit 0). 상세 `docs/review/2026-10-24-adversarial-review-r2.md`
  - 적대적 검토 Round 3 (R3): Task 18–23 실검토(R2-G 미수행분)와 R2 잔여 결함. 과금 무결제 적용(CRITICAL), 해시 기반 피치, 리포트 상수·가짜 발송, 테넌트 간 관측 데이터 노출, 마케팅 허위 사례를 수정했다. 정리 마이그레이션 0023을 추가하고 스냅샷 체인을 복구했다 · vitest 317/317(56 files) · typecheck 11/11(캐시 없음) · web·marketing·docs build exit 0 · 격리 DB E2E. 상세 `docs/review/2026-10-25-adversarial-review-r3.md`

---

## 법적 유의사항

- 원본의 로고, 브랜드명, 마케팅 문구, 고객 사례, 이미지 에셋은 **복제 금지** — 자체 브랜드로 재작성
- UI 레이아웃/기능 아이디어는 관찰 기반으로 재구현(코드/에셋 복사 아님)
- API 계약은 내부 클론용으로 재설계하되 관찰된 리소스 모델을 따름

## 모노레포 구조

```
arena/
├── apps/
│   ├── web/          # Next.js 15 메인 앱 (app.도메인)
│   ├── marketing/    # Astro 마케팅 사이트
│   ├── docs/         # 문서 사이트
│   └── mcp/          # MCP 서버 (ChatGPT/Claude)
├── packages/
│   ├── db/           # Drizzle 스키마 + 마이그레이션
│   ├── core/         # 메트릭 엔진, 분석 파이프라인
│   ├── llm/          # 프로바이더 어댑터 + 응답 수집기
│   ├── crawler/      # 사이트 크롤러, AI 접근성 체크
│   ├── jobs/         # Inngest 함수들
│   ├── ui/           # 공유 UI 컴포넌트
│   └── emails/       # 리포트/초대 이메일 템플릿
```
