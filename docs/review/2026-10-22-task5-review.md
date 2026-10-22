# Task 5 — 응답 수집 엔진

## 구현
- `packages/llm/src/providers`: 프로바이더별 어댑터 — ChatGPT(OpenAI Responses API + `web_search`), Claude(공식 Anthropic SDK, `claude-opus-5-5` + `web_search_20260209`, `pause_turn` 재개, `fallbacks: "default"`), Perplexity(Sonar, search_results), Gemini(Google Search grounding, 리다이렉트 URL의 출처 도메인 보정), Grok(xAI Agent Tools — Responses API `web_search`), DeepSeek(웹검색 없음). 키가 있는 모델만 등록, 공개 API 없는 모델(AI Overview·AI Mode·Copilot·Meta AI·Mistral)은 "수집 불가"로 표시. 개발 전용 시뮬레이션 프로바이더(`LLM_SIMULATED_PROVIDER=true` + 비프로덕션, 응답 `simulated=true`)
- `packages/jobs/src/collection`: `planRun`(플랜 모델 ∩ 설정된 어댑터, 웹사이트당 활성 런 1개, 크레딧 원자적 조건부 차감, run_items 생성, 활동 로그) / `executeRun`(SKIP LOCKED 클레임, 동시성, 추출·저장, 실패 항목 기록, 1회 환불, 위치 국가 전달, 텍스트 상한) / `finalizeRun` / `requeueStale` / `stalledRuns` / `cancelRun`(미처리 환불) / `dueSchedules`
- Inngest: `run/execute`(10개 단위 durable step) + 30분 cron 디스패처(지연 런 재개 포함). Inngest 미설정 시 `after()` 인라인 실행 + Vercel Cron `/api/cron/dispatch`(CRON_SECRET, 상수시간 비교)
- `core/billing/credits`: `reserveCredits`(조건부 UPDATE) / `refundCredits` / 원장
- 웹: Prompts → Runs 탭(모델 가용성, 수집 시작, 실시간 진행률 폴링, 취소), `GET /api/runs/:id`, v1 `response-streaming`(+status) 재작성
- 데모 시드: 실제 파이프라인 + 시뮬레이션 프로바이더로 14일 백데이트(멱등)
- 마이그레이션 `0005_collection`(runs 확장, run_items, responses.provider/simulated)

## 적대적 검토에서 발견·수정
| # | 심각도 | 내용 | 조치/증거 |
|---|---|---|---|
| 1 | CRITICAL(기존) | v1 `response-streaming`이 API 키 조직과 무관한 websiteId로 런 시작(타 조직 크레딧 소비), status도 타 조직 런 조회 가능 | 조직 소유 검증 후 404 |
| 2 | HIGH(기존) | 실패 응답을 "collection error" 행으로 `responses`에 저장 → 지표 오염 | 실패는 run_items에만 기록, 응답 0행 + 환불(테스트) |
| 3 | HIGH(기존) | 키 없는 모델은 MockProvider로 가짜 "Canvasly" 답변 저장 | 모의 경로 제거, 시뮬레이션은 개발 전용·플래그 저장 |
| 4 | HIGH(기존) | 크레딧 확인 후 차감(경쟁 조건), 재시도 시 중복 저장 | 조건부 UPDATE 1문 + run_items 유니크·상태 기반 멱등 |
| 5 | HIGH | xAI Live Search 폐기(라이브 호출 410 Gone) | Agent Tools(Responses API) 전환, 라이브 재호출 시 403(크레딧)로 경로 확인 |
| 6 | HIGH | 인라인 실행 중 프로세스 종료 시 런이 영구 "running" → 해당 사이트 수집 영구 차단 | `stalledRuns` + 디스패처 재개, 스테일 항목 재큐 테스트 |
| 7 | MEDIUM | 런 취소 불가 | `cancelRun` 미처리분 환불·재실행 허용 테스트 |
| 8 | LOW | 프롬프트 위치 국가 미반영, 응답 크기 무제한 | 위치 국가 전달·10만자 상한 테스트 |
| 9 | MEDIUM(기존) | seed가 가짜 응답을 실데이터처럼 삽입, 비멱등, 크레딧 불일치 | 실제 파이프라인 시뮬레이션 시드로 교체(멱등 확인) |
| 10 | MEDIUM(기존) | `weeklyReports` 등이 실제 발송 없이 lastSentAt만 갱신 | 제거 — Task 12/13/18에서 재구현 |

## 검증 증거
- vitest 129/129(18 files), typecheck 11/11, `next build` 성공
- 브라우저 E2E(founder@, Starter): Runs 탭 모델 가용성 표시 → 수집 시작(12 프롬프트×2 모델=24 크레딧 예약) → 진행률 폴링 → 완료 24/24(Grok 12 실패) · 환불 12 · 잔액 300→288. DB: 응답 12행(전부 simulated), 실패 항목 오류 기록, 원장 consume −24 / refund +12
- 시드: 14개 런·98개 응답(모두 simulated), 재실행 시 추가 없음

## 한계
- 실제 프로바이더 성공 응답은 키/크레딧 부재로 미검증(어댑터는 목 테스트 + xAI 라이브 경로 확인까지)
- Inngest 실서버 미연동(인라인 실행 경로로 E2E)
