# app.athenahq.ai 페이지 목록

> 출처: 공개 검색 인덱스(firecrawl map) + 공식 문서(llms.txt)의 "Open in AthenaHQ" 링크 교차 검증.
> 로그인 뒤 페이지는 문서 ↔ 앱 URL 매핑으로 복원한 것(★)과 실제 관찰된 URL로 구분.

## 1. 공개(비로그인) 라우트 — 실제 관찰

| URL | 설명 |
|---|---|
| `/` | 진입 → `/login?redirect=%2F`로 리다이렉트 |
| `/login` | 로그인 (Google / Microsoft / 이메일, `?redirect=` 지원) |
| `/signup` | 회원가입 |
| `/report/{shareId}` ★ | 공개 AI 검색 리포트 (링크 소지자 열람) |
| `/report/content/{shareId}` ★ | 공개 콘텐츠 제안 리포트 |
| `/bot` ★ | 크롤러 공개 문서(AthenaHQ Crawler 안내) |

## 2. 로그인 후 핵심 페이지 — 문서에서 실제 경로 확인됨

| URL | 문서명 | 설명 |
|---|---|---|
| `/home` | Home (Ask Athena chat homepage) | 인사 + 컴포저 + 추천칩 4종 채팅 홈 |
| `/ads` | Ads | ChatGPT·AI Mode·AI Overview 스폰서드 광고 표시 |
| `/glossary` | Glossary | 메트릭/개념 용어집 |
| `/organization` | — | 조직 화면 (`?tab=api` 관찰됨) |
| `/prompts` | Prompts | 프롬프트/토픽/페르소나/로케일 관리 (`?tab=prompt-universe` 관찰됨) |
| `/content` | Content | 콘텐츠 허브 (`?contentId=` 관찰됨) |
| `/content/edit/{id}` | — | 콘텐츠 편집기 (`?tab=content` 관찰됨) |
| `/pitch-workspace/success` | — | 피치 생성 완료 화면 |
| `/settings/api` | API & Embed Settings | API 키/MCP/Looker/임베드 |
| `/settings/integrations` | Integrations Settings | 통합 설정 |

## 3. 문서 ↔ 앱 매핑으로 복원한 페이지 ★

### 대시보드/분석
| URL | 설명 |
|---|---|
| `/olympus` | Olympus 대시보드(멘션/인용/SOV/포지션/가치, 커스텀 카드, 저장 뷰) |
| `/responses` | 전체 AI 응답 브라우저(필터/검색/CSV/드릴다운) |
| `/sources` | 인용 소스 도메인 랭킹 |
| `/sources/{root_domain}` | 소스 도메인 상세 분석 |
| `/sources/visualization` | 소스 시각화 |
| `/sources/analytics/{source_url}` | 단일 URL 인스펙터 |
| `/competitors` | 경쟁사 관리/비교 |
| `/heatmap` | 경쟁사 히트맵(토픽×브랜드) |
| `/shopping` | Shopping Insights(AI 쇼핑 카로셀) |

### 프롬프트/지식/액션
| URL | 설명 |
|---|---|
| `/prompts/discover/{runId}` | Discover 실행 결과 상세(프롬프트 후보 검수) |
| `/brand-profile` | 브랜드 프로필(정체성/속성/llms.txt/사이트맵/AI 접근성) |
| `/knowledge-base` | KB 워크스페이스(필라/팩트) |
| `/knowledge-base/review` | 승인 대기 주장 큐 |
| `/knowledge-base/{pillarId}` | 필라 상세 |
| `/insights` | AI 인사이트(활성/해결/버림) |
| `/oracle` | Oracle(부정확성/불일치/모델 상이 스캔) |
| `/outreach` | 인용 아웃리치 칸반 |
| `/site-health` | 사이트 헬스 개요 |
| `/site-health/keywords` | 키워드/랭킹 |
| `/site-health/releases` | 스테이징 체크(릴리스 비교) |
| `/site-health/site-map` | 사이트맵 |
| `/site-health/properties` | 크롤 범위 속성 |
| `/site-health/properties/{propertyId}` | 속성별 페이지 |
| `/site-health/optimizations` | 페이지 편집 최적화 보드 |
| `/site-health/optimizations/verification/{eventId}` | 라이브 콘텐츠 검증 |

### 콘텐츠/그룹/피치/리포트
| URL | 설명 |
|---|---|
| `/content/catalog-optimization` | Shopify 카탈로그 최적화 |
| `/group/{groupId}` | 그룹 집계 대시보드 |
| `/group/{groupId}/billing` | 그룹 빌링(공유 크레딧) |
| `/pitches` | 피치 워크스페이스 목록 |
| `/pitches/create` | 피치 생성 위저드(2단계) |
| `/pitches/setup` | 피치 설정 개요 |
| `/pitches/usage` | 피치 사용량 |
| `/pitches/content` | 콘텐츠 피치 목록 |
| `/pitches/content/create` | 콘텐츠 피치 생성 |
| `/pitches/content/{id}` | 콘텐츠 피치 상세(공개 보기) |
| `/reports` | 리포트 목록/빌더 |
| `/reports/{id}` | 리포트 편집(차트/수신자/즉시 발송/PDF) |
| `/onboarding` | 웹사이트 추가 온보딩 위저드(저장/재개 지원) |

### 설정 (Settings)
| URL | 설명 |
|---|---|
| `/settings/general` | 일반 설정 |
| `/settings/profile` | 프로필 설정 |
| `/settings/users` | 유저/팀/접근 관리 |
| `/settings/billing` | 빌링(플랜/크레딧/인보이스/결제수단) |
| `/settings/security` | 보안(SAML/OIDC SSO, 세션) |
| `/settings/activity` | 조직 액티비티 로그 |

## 4. 관찰된 탭/쿼리 파라미터 패턴

- `?redirect=%2Fhome` — 로그인 후 복귀 경로
- `?tab=prompt-universe` — Prompts 내부 탭
- `?tab=content` — 콘텐츠 편집기 탭
- `?tab=api` — 조직 화면 API 탭
- `?contentId={uuid}` — 콘텐츠 특정 아이템

## 5. 시스템/내부 엔드포인트 (관찰)

| 경로 | 설명 |
|---|---|
| `/api/version` | 배포 버전 체크 |
| `/api/csp-report` | CSP 위반 리포트 수집 |
| `/api/otel/traces` | OpenTelemetry 트레이싱 수집 |
| `/_vercel/insights/script.js` | Vercel Analytics |
| `/_vercel/speed-insights/script.js` | Vercel Speed Insights |
| `/buifob/*` | PostHog 리버스 프록시(flags, recorder, surveys, web-vitals, exception-autocapture) |
| `/_next/static/immutable/*` | Turbopack 빌드 청크 |
| `/theme-bootstrap.js`, `/manifest.webmanifest`, `/icon.svg` | 테마/PWA/아이콘 |
