# 적대적 검토 Round 2 (R2) — 무결성·실제 연동·권한 강화 리포트 (2026-10-24)

## 1. 개요 및 검증 원칙
- **대상 범위**: Tasks 12–23 (`Knowledge Base`, `Oracle`, `Insights`, `Outreach`, `Shopping Insights`, `Sponsored Ads`, `Content Hub & CMS`, `Shopify Catalog Optimization`, `Site Health`, `Report Builder`, `Pitch Workspace`, `Ask Athena Chat`)
- **핵심 무결성 원칙 (Zero Fabrication & Strict RBAC)**:
  1. **허구/시드 데이터 생성 전면 금지**: 외부 API 자격 증명이나 AI 제공자 키가 설정되지 않았거나 수집된 응답 데이터가 없을 때, 존재하지 않는 인물·이메일·광고·카탈로그 제품·웹페이지·키워드 순위를 만들어 저장하지 않는다.
  2. **외부 부작용 없는 "발행/적용 완료" 표시 금지**: WordPress, Shopify 등 외부 CMS/커머스 연동은 SSRF 안전 HTTP 클라이언트(`safeFetch`)와 암호화된 자격 증명(`enc:`)을 사용해 실제 원격 API가 `2xx`를 반환할 때만 `published`로 기록한다.
  3. **조회(GET) 요청 시 DB 쓰기/스캔 부작용 제거**: 페이지 서버 컴포넌트 렌더링 중 자동 시드·크롤·추출·스캔을 수행하지 않으며, 모든 변경 작업은 명시적 Server Action 또는 백그라운드 잡(`*ForSite`)에서만 실행한다.
  4. **선택적 `actorId` 권한 우회 차단**: 사용자 호출 코어 함수에서 `actorId?: string`으로 `requireWebsitePermission`을 건너뛰던 경로를 제거하고, 백그라운드 워커 전용 진입점(`*ForSite`)과 사용자 진입점(`actorId: string` 필수)을 분리했다.

---

## 2. 발견 사항 및 수정 내역 (R2-A ~ R2-H)

| 구분 | 심각도 | 대상 모듈 | 문제점 (Before) | 수정 내용 (After) |
|---|---|---|---|---|
| **R2-A** | CRITICAL | `packages/core/src/outreach/*`<br>`0018_outreach_fabricated_cleanup.sql` | 하드코딩된 가상 인물·이메일 디렉터리(`research-editorial@g2.com` 등)와 `editorial@{domain}` 추측 주소를 반환하고, 인용되지 않은 폴백 URL을 생성함 | 실제 `response_citations`에서 집계된 제3자 인용 URL만 기회로 생성하고, 작성자 탐색은 `safeFetch`로 실제 기사 HTML의 JSON-LD/meta/byline/mailto만 파싱(`authorFromHtml`)하도록 재작성. 가짜 연락처·기회 정리 마이그레이션(`0018`) 추가 |
| **R2-B** | HIGH | `packages/core/src/commerce/*`<br>`packages/core/src/extract/shopping.ts`<br>`0019_commerce_fabricated_cleanup.sql` | `captureSponsoredAds`와 `syncShoppingProducts`가 템플릿 광고 문구와 가짜 제품(`AI Design Canvas Pro` $29 등)을 생성함 | 수집된 AI 응답(`responses.rawText`, `shoppingCard`)에서 실제로 관찰된 제품 카드와 스폰서 광고 블록만 추출·집계하도록 재작성. 기존 템플릿 광고/제품 정리 마이그레이션(`0019`) 추가 |
| **R2-C1/C2** | HIGH | `packages/core/src/content/{grounding,hub,pipeline,html,cms-targets,cms}.ts`<br>`packages/crawler/src/net.ts` | `/content` 첫 방문 시 데모 기사를 시드하고, 8개 CMS에 실제 네트워크 호출 없이 `published`로 표시하며, LLM 호출 없이 템플릿 블록을 덧붙임 | `seedInitialContentItems` 제거, `@athena/llm/assist`(`generateStructured`) 기반 브리프·초안·수정 작성기(`content-writer.ts`) 연결, WordPress REST API 및 Shopify Admin API 실제 발행(`cms.ts` + `safeFetch` POST/PUT) 및 export 전용 CMS 분리, 자격 증명 AES-256-GCM 암호화(`enc:`) 적용 |
| **R2-C3** | HIGH | `packages/core/src/content/catalog.ts`<br>`0020_content_fabricated_cleanup.sql` | Shopify 연동 없이 가짜 카탈로그 제품을 생성하고, 네트워크 호출 없이 `published`로 표시함 | 실제 Shopify Admin API(`GET /admin/api/2025-01/products.json`, `PUT /products/{id}.json`)와 연동하고, 설명적인 규칙 기반 점수(`catalogScores`: 비라틴 문자 대문자 오판 수정, 라인 단위 질문 카운트)와 실제 Shopify 응답 검증 후에만 `published`로 전환. 정리 마이그레이션(`0020`) 추가 |
| **R2-D** | HIGH | `packages/core/src/site-health/index.ts`<br>`0021_site_health_fabricated_cleanup.sql` | `runSiteHealthCrawl`이 네트워크 요청 없이 5개 가짜 페이지·키워드 검색량·검증 해시를 심고, `/site-health` 조회(GET) 시 자동 실행됨 | SSRF 안전 `fetchSiteResource`(`safeFetch`)를 주입받아 실제 `/robots.txt`(RFC 9309 파서로 10대 AI 봇 판정), `/llms.txt`, `/sitemap.xml`, 페이지 HTML `<title>` 및 JSON-LD `@type`을 크롤링하도록 재작성. 라이브 콘텐츠 검증 시 실제 응답 본문의 SHA-256 해시를 기록하고, GET 시 자동 크롤 제거. 정리 마이그레이션(`0021`) 추가 |
| **R2-E/F** | MEDIUM | `packages/core/src/knowledge/{kb,oracle}.ts`<br>`packages/core/src/insights/index.ts`<br>`0022_kb_fabricated_cleanup.sql` | `extractKnowledgeFacts`가 템플릿 문장과 가짜 `/features` URL을 `confirmed`로 즉시 저장하고, 코어 함수들이 선택적 `actorId`로 권한 검사를 우회하며 페이지 GET 시 쓰기를 유발함 | 추출된 후보 팩트는 모두 `pending_review`(`sourceUrl: null`)로 큐잉하고 하드코딩된 베이스라인 팩트 제거. `runOracleScan`/`generateInsights`에서 `actorId: string`을 필수로 강제하고 백그라운드 잡 전용 `*ForSite` 함수 분리. `insights`, `oracle`, `knowledge-base` 페이지 GET 시 쓰기 호출 전면 제거. 정리 마이그레이션(`0022`) 추가 |
| **R2-G/H** | LOW | `packages/core/src/pitches/index.ts`<br>`packages/core/src/reports/index.ts`<br>`apps/web/src/app/api/athena/chat/route.ts` | 공개 공유 토큰(`shareId`)이 64~72비트(`randomBytes(8~9)`)였으며, 채팅 라우트 본문 상한(512KB)이 멀티바이트 첨부 한도보다 작고 `maxDuration=60`이 짧음 | `pitches` 및 `reports` 공유 토큰을 128비트(`randomBytes(16).toString("hex")`)로 상향하고, `/api/athena/chat`의 `MAX_BODY_BYTES`를 `2_000_000`(2MB), `maxDuration`을 `120`으로 상향 |

---

## 3. 자동화 검증 결과
- **단위 및 통합 테스트 (`npx vitest run`)**: 전체 48개 테스트 파일 통과 (`exit 0`)
- **타입 체크 (`npx turbo run typecheck`)**: 전체 11개 패키지 통과 (`11/11 successful`)
- **프로덕션 빌드 (`npx turbo run build`)**: 전체 앱 및 패키지 프로덕션 빌드 통과 (`exit 0`)
- **DB 마이그레이션 (`0018` ~ `0022`)**: 가짜/시드 데이터 정리 SQL 마이그레이션 적용 및 스키마 무결성 검증 완료
