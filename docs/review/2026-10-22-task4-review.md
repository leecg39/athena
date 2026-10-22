# Task 4 — Prompts 화면 (CRUD · Discover · 스케줄)

## 구현
- `packages/core/src/prompts`: 프롬프트 CRUD(정규화·대소문자 무시 중복 거부·branded 재분류·플랜 한도·웹사이트 행 잠금), 필터 목록(토픽/태그/페르소나/위치/스케줄/상태/유형/검색 — LIKE 와일드카드 이스케이프), 일괄 작업(일시정지/재개/삭제/토픽 이동/태그 추가·제거/스케줄 지정, 자기 웹사이트 행만), 토픽·태그·페르소나·위치 CRUD(삭제 시 프롬프트 참조 해제), 스케줄(커스텀 생성·주기 변경·할당·보관 시 기본 스케줄로 재배치, 기본 스케줄 보관 금지), 모든 변경 활동 로그
- Discover: Search Console 상위 검색어(노출수, `searchAnalytics.query`) / 수집 응답 기반 경쟁사 갭(브랜드 미언급 응답에 등장한 경쟁사) / 사이트 분석(LLM 또는 확인된 제품 기반 템플릿, 출처 표기) → 대소문자 무시 병합, 이미 추적 중인 프롬프트 제외
- 웹: `/prompts?tab=prompt-universe|topics|tags|personas|locations|schedules|discover`(관찰된 URL 패턴), 서버 액션, 편집·일괄 작업 폼, Discover 결과에서 선택 추적(검색 노출수 → volumeEstimate)
- 마이그레이션 `0004_taxonomy_ci`(토픽: 활성 행 대상 lower(name) 부분 유니크, 태그: lower(name) 유니크)

## 적대적 검토에서 발견·수정
| # | 심각도 | 내용 | 조치/증거 |
|---|---|---|---|
| 1 | HIGH(기존) | 프롬프트 추가·삭제가 클라이언트 상태뿐(저장 안 됨), Discover는 데모 데이터 | 전부 DB·서버 액션화, 브라우저 E2E로 저장 확인 |
| 2 | MEDIUM | 토픽/태그 유니크 인덱스가 대소문자 구분 + 삭제된 행 포함 → 삭제된 이름으로 변경 시 DB 오류 | 부분·lower 인덱스로 교체, 토픽 확보는 잠금 하 조회-삽입 |
| 3 | MEDIUM | `listSchedules/listTopics/listTags`의 카운트 서브쿼리에서 외부 컬럼이 비한정 렌더링 → 항상 0 | 명시적 테이블 한정, 카운트 단언 테스트 추가 |
| 4 | LOW | 동시 생성 시 유니크 위반이 "Something went wrong"으로 노출 | 23505(ORM cause 포함) → 사용자 메시지, 테스트 |
| 5 | LOW | Discover(GSC/LLM 비용) 무제한 실행 | 사용자당 20회/10분 리미터 |
| 6 | LOW | 추가 폼이 성공 후에도 입력값 유지 | `resetOnSuccess` |
| 7 | LOW | 일괄 작업 폼 안 행별 폼(중첩 form, 무효 HTML) | 행별 토글 제거, 일괄 작업으로 일원화 |

## 검증 증거
- vitest 112/112(16 files), typecheck 11/11, `next build` 성공
- 브라우저 E2E(founder@, Vercel): 태그 생성 → 프롬프트 추가 → 중복 거부("This prompt is already tracked") → 템플릿 4개 일괄 삭제(14→10) → 2개 태그 지정 후 태그 필터로 2개만 표시 → 검색+편집으로 텍스트 변경·branded 재분류 → 스케줄 "Low priority/weekly" 생성 → Discover 실행(미연결 소스 안내 + 제품 기반 템플릿) → 2개 추적("2 prompt(s) now tracked")

## 한계
- GSC 검색어 기반 발견은 Google 자격증명 부재로 목 테스트만, 경쟁사 갭은 Task 5 수집 이후 실데이터로 동작
