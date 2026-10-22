# Athenum — AthenaHQ 풀 스택 클론

app.athenahq.ai를 REA(역분석) 방식으로 관찰한 증거를 기반으로 재구현한 AEO/GEO SaaS입니다.
AI 검색(ChatGPT·Perplexity·Gemini 등)에서 브랜드의 멘션·인용·점유율을 추적하고, 콘텐츠 생성·아웃리치·커머스 액션까지 실행합니다.

> 원본 브랜드 자산(로고/문구/사례)은 복제하지 않았습니다 — 모든 UI와 카피는 자체 브랜딩으로 재작성.

## 구조

| 경로 | 설명 | 포트 |
|---|---|---|
| `apps/web` | 메인 앱 (Next.js 15, 인증, 30개 라우트, 공개 API `/api/v1`) | 3000 |
| `apps/marketing` | 마케팅 사이트 (Astro) | 4321 |
| `apps/docs` | 문서 사이트 (Astro) | 4322 |
| `apps/mcp` | MCP 서버 (ChatGPT/Claude 연동) | stdio |
| `packages/db` | Drizzle 스키마 전체 (조직/프롬프트/응답/KB/콘텐츠/과금 …) | — |
| `packages/core` | 메트릭 엔진(SOV·멘션률·인용률·포지션) + 응답 구조화 추출 | — |
| `packages/llm` | LLM 프로바이더 어댑터 6종 + 수집기 (모의 프로바이더 내장) | — |
| `packages/crawler` | 사이트 크롤러 + AI 봇 접근성 체크 | — |
| `packages/jobs` | Inngest 워크플로 (스케줄 수집, 인사이트, Oracle 스캔, 리포트) | — |
| `packages/emails` | 리포트/초대 이메일 템플릿 (react-email) | — |

## 실행

```bash
cp .env.example .env        # 키 없이도 데모 데이터로 동작
npm install
npm run dev                 # turbo: web(3000) + marketing(4321) + docs(4322)
```

DB 준비(선택 — 없으면 모의 데이터로 렌더):

```bash
# .env의 DATABASE_URL을 Neon 등으로 설정 후
npm run db:push             # 스키마 반영
npm run db:seed             # 데모 데이터 시딩
```

## 빌드/검증

```bash
npm run build               # turbo: 전체 빌드
npm run typecheck           # TS 전수 검사
```

## 응답 수집 엔진

- `prompt × model` 조합당 크레딧 1 소비(잔액 선검증 → 원장 기록)
- 프로바이더: OpenAI(웹서치) · Perplexity(Sonar) · Anthropic(웹서치) · Gemini(그라운딩) · xAI · DeepSeek — 키가 없는 모델은 자동으로 모의 응답
- 구조화 추출: 멘션/감성/포지션, 인용 URL→도메인 소스 집계, 속성 관측(−1~1), 쇼핑 카드
- 폴링 계약: `POST /api/v1/response-streaming` → `workflow_id` → `GET /api/v1/response-streaming/status?runId=`

## 배포 (Vercel)

앱/마케팅/문서를 각각 Vercel 프로젝트로 연결 (모노레포 루트 지정, `apps/<name>` 각각).
환경변수는 `.env.example` 참고. `CRON_SECRET`으로 `/api/inngest` 보호.
