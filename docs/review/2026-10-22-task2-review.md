# Task 2 — 조직/웹사이트 모델 + RBAC + 액티비티 로그 + Settings 8종

## 구현
- `packages/core/src/org/*`: RBAC(역할→권한, 커스텀 롤), 멤버·초대(토큰은 SHA-256 해시만 저장, 7일 만료)·역할 변경, 그룹, API 키(해시 저장, `ath_` 접두사), 조직/웹사이트/프로필 설정, 세션 일괄 폐기(`users.session_version`), 모든 변경에 `activity_log` 기록(같은 트랜잭션)
- 웹사이트 접근 범위: owner/admin/billing = 조직 전체, member/custom = 웹사이트·그룹 멤버십
- Settings 8종 + `/invite/[token]` + `/organization` 을 실제 DB·서버 액션으로 연결
- 마이그레이션 `0001_org_rbac`

## 적대적 자기 검토에서 발견·수정
| # | 심각도 | 내용 | 조치 |
|---|---|---|---|
| 1 | HIGH | `members:write` 보유자가 자신보다 강한 역할/권한을 부여 가능(권한 상승) | `assertCanGrant` — 비-owner는 자신이 가진 권한의 부분집합만 부여·관리. 레드-그린 검증 |
| 2 | LOW | `deleteCustomRole`이 소유 조직 확인 전에 사용 여부 조회 | 소유 확인 선행 |
| 3 | MEDIUM | 액티비티 페이지네이션이 `created_at`만 사용 → 동일 시각(트랜잭션 내 `now()`) 행 누락, JS Date는 µs 손실 | `(created_at, id)` 키셋 + 커서 행의 DB 값 직접 비교 |
| 4 | LOW | `members:read` 없는 커스텀 롤로 Users 페이지 접근 시 500 | 권한 안내 화면 |
| 5 | MEDIUM | 레이트리밋 버킷 Map 무한 증가(무작위 토큰 플러딩) | 상한 10,000 + 유휴 버킷 정리, 테스트 |
| 6 | LOW | 세션 폐기 후 재로그인 시 원래 경로 유실 | 미들웨어가 `x-pathname` 전달 → `requireUser` 사용 |
| 7 | CRITICAL(기존) | `ah_live_demo` 키가 DB 장애 시 인증 우회 | 제거, `verifyApiKey`로 일원화 |

## 검증 증거
- vitest 26/26 (core org 14 · tenancy 6 · web 6), typecheck 11/11, `next build` 성공
- 브라우저 E2E(dev 서버): 조직명 변경·그룹 생성 저장 및 activity 기록 / API 키 생성(1회 표시)→ `/api/v1/validate-api-key` 200, 잘못된 키·구 백도어 401, 평문 미저장 / 초대 생성→로그아웃→초대 링크→로그인 리다이렉트→수락→SmokeCo 접근(website 범위) / member 역할은 API 키·빌링·멤버 관리 차단 / "모든 세션 로그아웃" 후 별도 세션 307 → `/login?redirect=<원경로>`

## 남은 한계
- 이메일 발송은 `RESEND_API_KEY` 설정 시에만(미설정 시 링크 1회 표시)
- GSC/GA4 OAuth 연결은 Task 3 이후, CMS/Slack 연결은 Task 14/18
