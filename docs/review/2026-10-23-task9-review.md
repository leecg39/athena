# Task 9 — Sources 분석

## 구현
- 원본 문서(API 레퍼런스) 정의를 따름: 인용률 = 해당 도메인을 인용한 답변 / 필터 내 전체 답변, 브랜드·경쟁사 멘션률 = 해당 도메인을 인용한 답변 중 언급 비율, 유형 = owned(자사 호스트·하위 도메인·지정 URL) / competitor(추적 경쟁사 루트 도메인) / partner(지정) / third_party(나머지), 재지정 우선순위(정확 URL 접두 → 자사 → 도메인 재지정 → 경쟁사 → 기타)
- `core/sources`: URL 정규화(추적 파라미터·fragment·끝 슬래시 제거, 쿼리 정렬), 등록 도메인(tldts, 사설 접미사 분리), 분류기, 도메인 랭킹(+일별 스파크라인), 도메인 상세(추이·인용 페이지·프롬프트·경쟁사·답변), URL 인스펙터(추이·모델별·변형 URL·답변), Sankey(소스 → 브랜드/경쟁사), 유형 재지정 CRUD(활동 로그), API용 `listSourcesForSite`
- 수집기: 인용 저장 시 `root_domain`·`normalized_url` 계산, 기존 252행 백필(`backfillCitationColumns`)
- 웹: `/sources`(도메인 랭킹 · 시각화 · 소스 유형 탭, URL 필터·페이지), `/sources/[domain]`, `/sources/url?u=`, v1 `GET /api/v1/sources` 실데이터 재활성화(조직 소유 검증)
- 마이그레이션 `0006_sources`

## 적대적 검토에서 발견·수정
| # | 심각도 | 내용 | 조치/증거 |
|---|---|---|---|
| 1 | HIGH(기존) | Sources 화면·v1 sources가 데모 데이터, 유형 정의(C=community)가 원본과 불일치 | 실집계 + 원본 정의(owned/competitor/partner/third_party) |
| 2 | MEDIUM | `/sources/[domain]`이 이미 디코딩된 파라미터를 재디코딩 → `%` 포함 경로에서 URIError(500) | 재디코딩 제거, `%25` 경로 200 확인 |
| 3 | LOW | 등록 도메인 직접 계산 시 `co.uk` 등 오류 위험 | 검증된 tldts 사용(공급망 위험 고려해 3주 이상 된 7.4.16 고정) |
| 4 | LOW | 재지정 패턴 입력 형식 다양(스킴·www·슬래시), `javascript:` 등 | 정규화 + 형식 검증(테스트) |

## 검증 증거
- vitest 173/173(25 files), typecheck 11/11, `next build` 성공
- 브라우저 E2E(demo@, Canvasly): 도메인 랭킹·스파크라인(techcrunch 41/98=41.8%), Sankey 렌더, 유형 재지정(`https://www.reddit.com/` → `reddit.com` Partner 반영), g2.com 상세 "37 of 98"(SQL 37 일치), URL 인스펙터(추적 파라미터 붙은 URL도 동일 페이지로 집계, `javascript:` 거부)
- v1 sources: 타 조직 404, 자기 조직 200, 잘못된 type 400
