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
- [ ] **12. Insights 엔진** — 주기적 AI 인사이트 생성(기회 경보, 콘텐츠 갭, 경쟁사 변화) + 활성/해결/버림 상태 관리 화면

## Phase 4 — 지식 & 콘텐츠 & 액션

- [ ] **13. Knowledge Base + Oracle** — KB(필라/팩트 CRUD + 승인 큐 + 내부링크 페이지) + Oracle(응답 vs KB 부정확성 스캔: 확정된 부정확/KB 불일치/모델 상이 분류 + 해결 워크플로)
- [ ] **14. Content Hub** — 스프레드시트형 그리드 + AI 에이전트 컬럼(브리프→초안→버전) + Revise with Athena + CMS 발행 통합(WordPress/Webflow/Contentful/Sanity/Wix/Framer/Payload) + Shopify Catalog Optimization
- [ ] **15. Outreach** — 인용 기회 페이지 목록(인용률·예상 노출) + 발신자 찾기 + 이메일 초안 생성 + 칸반 파이프라인(New/Todo/Done)

## Phase 5 — 커머스 & 사이트 & 리포트

- [ ] **16. Shopping Insights + Ads** — AI 쇼핑 카로셀 노출/포지션/가격/경쟁사 비교 + 소매사 분포 / ChatGPT·AI Mode·AI Overview 스폰서드 광고 캡처 표시
- [ ] **17. Site Health** — 키워드/랭킹, 스테이징 체크(릴리스 비교), 사이트맵, 크롤 범위, 페이지 편집 최적화 보드, 라이브 콘텐츠 검증 + AI 크롤러 접근성 체크(OAI-SearchBot 등)
- [ ] **18. Report Builder** — 차트 조합 편집기 + 수신자/스케줄 + PDF 내보내기 + 공개 공유 링크(AI 검색 리포트/콘텐츠 제안 리포트) + Slack 주간 리포트

## Phase 6 — 에이전시 & 과금

- [ ] **19. Pitch Workspace + Groups** — 사이트 URL 기반 피치 리포트 생성 위저드 + 공개 공유 뷰 + 콘텐츠 리라이트 피치 + 사용량 관리 + Group Dashboard/Group Billing(그룹 집계 대시보드 + 공유 크레딧)
- [ ] **20. Stripe 과금** — Free/Starter($295)/Enterprise 플랜 + 크레딧 시스템(조직/웹사이트/그룹 잔액 + 원장) + 추가 크레딧/API 애드온 과금 + 인보이스

## Phase 7 — API & 운영 & 배포

- [ ] **21. 공개 REST API + MCP** — `/api/v1`(basics/metrics/sources/content/kb/billing/teams 전 표면, 관찰된 계약 재설계) + MCP 서버(ChatGPT/Claude 연동) + Looker Studio/Power BI 커넥터 + 레이트 리밋
- [ ] **22. 관측/운영** — PostHog(이벤트/세션 리플레이/서베이) + Vercel Analytics/Speed Insights + OpenTelemetry 트레이싱 + CSP 리포트 + 랜딩/이메일 템플릿
- [ ] **23. 마케팅 사이트 + 배포** — Astro 마케팅 사이트(홈/플랫폼/가격/산업/비교/케이스스터디/블로그 구조 재현, 자체 브랜딩) + Vercel 프로덕션 배포(앱/마케팅/문서/MCP 4개 프로젝트) + E2E 검증

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
