# Task 3 — 온보딩 위저드 + 크롤러 브랜드 자동 제안

## 구현
- `packages/crawler`: SSRF 안전 fetch(소켓 lookup 단계에서 해석 IP 검증 → DNS rebinding 차단, 리다이렉트 홉마다 재검증, http/https·표준 포트만, URL 자격증명 금지, 압축 해제 후 바이트 상한, 전체 데드라인), RFC 9309 robots.txt(그룹·정확 토큰 매칭·최장 일치·allow 우선·`*`/`$`), 브랜드 추출(og:site_name → 도메인과 일치하는 title 세그먼트 → 도메인, JSON-LD Organization), sitemap(인덱스 1단계, 요청 4회·2MB 상한), AI 크롤러 13종 접근성
- `packages/llm/assist`: 구조화 출력 디스패처 — Anthropic(공식 SDK `beta.messages.parse` + `zodOutputFormat`, `claude-opus-5-5`, effort low, `fallbacks: "default"`), OpenAI/xAI/DeepSeek(JSON mode), Gemini. 키 없으면 `unavailable`(가짜 데이터 금지), 크롤링 텍스트는 `<website_data>` 블록으로 분리해 프롬프트 인젝션 완화, 결과 zod 검증·정규화
- `packages/core/onboarding`: 브랜드 프로필 / 경쟁사(도메인 정규화·중복·자사 제외) / 토픽·프롬프트(대소문자 무시 중복 제거, branded 분류, 플랜별 한도) / 지역·페르소나 / 기본 스케줄(미할당 프롬프트 연결) / 완료 — 모두 멱등, 활동 로그 기록
- `packages/core/integrations`: AES-256-GCM 자격증명 봉인, HMAC 서명·만료 OAuth state, GSC(읽기 전용 스코프, 코드 교환, 속성 매칭, 암호화 저장, 해제)
- 웹: `/onboarding` → `/onboarding/[websiteId]/[step]` 7단계(재개 가능, Suspense), `/api/integrations/gsc/{connect,callback}`, Settings → Integrations에 GSC 실제 상태
- 마이그레이션 `0002_onboarding`(진행 단계·완료 시각, 부분 유니크 인덱스, prompt↔persona/location FK), `0003_integrations`

## 적대적 검토에서 발견·수정
| # | 심각도 | 내용 | 조치/증거 |
|---|---|---|---|
| 1 | CRITICAL(기존) | `/api/onboarding/probe`가 임의 URL을 서버에서 fetch(SSRF) | 엔드포인트 제거, 안전 fetcher로 서버 액션화. `http://169.254.169.254`·`localhost`·`[::1]`·사설 리다이렉트 차단 테스트 |
| 2 | HIGH(기존) | 경쟁사 제안 하드코딩(figma/canva/adobe), 위저드 저장 없음, GSC 버튼이 플래그만 변경 | LLM 제안(없으면 정직한 안내) + 전 단계 DB 저장 + 실제 OAuth |
| 3 | HIGH | 동시 저장 시 플랜 프롬프트 한도 초과(경쟁 조건) | 웹사이트 행 `FOR UPDATE`. 실제 Postgres 6개 동시 요청: 잠금 없음 90개(한도 50 초과) → 잠금 후 45개·3건 거부 |
| 4 | MEDIUM | React 19 form action이 오류 시 입력값을 초기화 | `ActionForm`을 transition 제출로 변경, 브라우저에서 오류 후 입력 보존 확인 |
| 5 | MEDIUM | 같은 조직에 동일 도메인 중복 등록 | `createWebsite` 중복 거부(테스트·브라우저 확인) |
| 6 | LOW | 잘못된 도메인이 일반 Error → "Something went wrong" | `DomainError`로 사용자 메시지 |
| 7 | MEDIUM | 크롤 요청 무제한(자원 남용) | 사용자당 10회/10분 리미터, sitemap 요청·크기 상한 축소 |
| 8 | LOW | 제품 필드에 h2 마케팅 문구 자동 입력, 태그라인 기반 템플릿 어색 | 제품 필드 공란 시작, 확인된 제품 목록 우선 템플릿 |
| 9 | LOW | 일정 단계가 플랜 크레딧 초과 일정을 기본 선택 | 한도 내 최빈 일정 기본값 + 초과 경고 |
| 10 | LOW(테스트) | 암호문 변조 테스트가 base64 패딩 비트만 바꿔 간헐 실패 | 실제 바이트 플립으로 결정적 테스트 |

## 검증 증거
- vitest 97/97(13 files), typecheck 11/11, `next build` 성공
- 실 크롤: anthropic.com·vercel.com 정상, `http://169.254.169.254` BlockedUrlError
- 브라우저 E2E(신규 사용자 founder@): 로그인 → `/onboarding` → vercel.com 분석(이름·설명·AI 크롤러 표) → 경쟁사 수동 입력(오류 후 입력 보존) → 템플릿 프롬프트+수동 2개 → 지역 2·페르소나 2 → GSC 미설정 안내·건너뛰기 → 주간 일정 → `/prompts` 13개 표시. DB: 프로필·경쟁사 2·위치 2·페르소나 2·weekly 스케줄(13개 연결)·onboarded_at·활동 로그 6건

## 한계 (정직한 표기)
- 이 환경의 LLM 키는 xAI뿐이며 크레딧 소진(403) → LLM 제안 경로는 목(mock) 테스트로만 검증. 화면에는 "AI 제안을 생성할 수 없음"이 표시됨
- GSC OAuth는 Google 자격증명 부재로 목 테스트(토큰 교환·속성 매칭·state·암호화)만 수행, 실제 동의 화면 E2E 미실시
