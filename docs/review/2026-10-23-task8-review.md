# Task 8 — Responses 브라우저 (+ 공개 API 테넌트 격리 긴급 수정)

## 구현
- `core/analytics/filters.ts`: Olympus·Responses·API 공용 조건 빌더(기간·모델·토픽·페르소나·위치·태그·프롬프트·유형 + 멘션/인용 여부·경쟁사·검색어[와일드카드 이스케이프])
- `core/analytics/responses.ts`: 답변 목록(소스 수·상위 도메인·언급 경쟁사 집계, 페이지네이션), 프롬프트×모델 매트릭스(기간 내 최신 답변, DISTINCT ON), 답변 상세(언급·인용·속성 관측·런 정보), API용 `responsesForSite`
- `core/extract` `highlightSegments`: 답변 텍스트를 일반/엔티티 구간으로 분할(HTML 주입 없이 렌더링)
- 웹: `/responses`(답변 목록 ⇄ 매트릭스, URL 필터, 페이지), `/responses/[id]`(브랜드·경쟁사 하이라이트, http(s) 출처만 링크·`noopener noreferrer nofollow`), `/api/responses/export`(최대 1만 행, 수식 주입 방어)

## 적대적 검토에서 발견·수정
| # | 심각도 | 내용 | 조치/증거 |
|---|---|---|---|
| 1 | CRITICAL(기존) | `/api/v1/responses·prompts·content·basics·metrics`가 API 키 조직을 확인하지 않음 → 임의 websiteId로 타 조직 답변 원문·프롬프트·콘텐츠 열람 | 공용 가드 `resolveApiWebsite`. 실서버에서 타 조직 5개 엔드포인트 404, 자기 조직 200 |
| 2 | CRITICAL(기존) | `POST /api/v1/prompts·content`가 타 조직 웹사이트에 쓰기 가능(플랜 한도·중복·감사 로그도 우회) | 501로 비활성화(Task 21에서 core 서비스로 재구현). 주입 시도 후 행 0건 확인 |
| 3 | HIGH(기존) | `/api/v1/metrics·sources`가 데모(가짜) 수치를 실데이터처럼 반환 | metrics는 실집계(`visibilityForSite`)로 교체, sources는 Task 9 전까지 501 |
| 4 | HIGH(기존) | v1 responses가 첫 응답의 언급·인용만 반환 | 응답별 집계로 교체 |
| 5 | HIGH(잠복, Task 7) | `exists(sql…)`가 괄호 없이 렌더링 → Olympus 태그 필터 선택 시 SQL 구문 오류 | 원시 `exists (…)`로 수정, 회귀 테스트 레드-그린 확인 |
| 6 | MEDIUM(기존) | 클라이언트 측 데모 필터링·CSV(수식 주입 무방비) | 서버 측 필터·CSV 인코딩 |

## 검증 증거
- vitest 163/163(24 files), typecheck 11/11, `next build` 성공
- 브라우저 E2E(demo@, Canvasly): 목록 렌더 → "미언급 + Figma 언급" 필터 22건(SQL 22건 일치) → 상세(하이라이트·출처·순위) → 매트릭스(프롬프트 7 × 모델) → CSV 40행(SQL 40 일치) → 타 테넌트 응답 ID 404(정보 노출 없음) → 필터 분리 후 Olympus 태그 필터 200
- API 키 교차 테넌트 시험: 위 #1·#2 결과

## 한계
- 답변 텍스트 검색은 ILIKE 전체 스캔(대규모 시 trigram 인덱스 필요)
