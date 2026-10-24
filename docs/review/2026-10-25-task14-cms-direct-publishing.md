# Task 14 잔여 — CMS 직접 발행 6종 구현과 적대적 검토 (2026-10-25)

결론: Content Hub가 이제 8개 CMS(WordPress, Webflow, Contentful, Sanity, Wix, Framer, Payload CMS, Shopify)에 직접 발행한다. R3 검토에서 "WordPress·Shopify만 지원, 나머지는 내보내기만"으로 남겨 둔 부분이다. 원칙은 R2·R3와 같다. CMS가 요청을 받아들였을 때만 `published`로 기록한다. 여러 단계로 된 흐름은 마지막 단계까지 성공해야 한다.

## 1. 공급자별 흐름 (공식 문서로 확인한 형태)

| CMS | 요청 | 게시 판정 | 실패 시 |
|---|---|---|---|
| Webflow | `POST api.webflow.com/v2/collections/{id}/items/live` (Bearer, `CMS:write`), `fieldData{name, slug, [본문 필드]: HTML}` | 202 + item `id` | 오류 메시지·details 표시 |
| Contentful | `POST …/entries` (`X-Contentful-Content-Type`, `application/vnd.contentful.management.v1+json`) → `PUT …/entries/{id}/published` (`X-Contentful-Version`) | 게시 단계 200 | 만든 초안을 `DELETE`. 삭제하지 못하면 초안 ID를 알려 준다 |
| Sanity | `POST {project}.api.sanity.io/v2025-02-19/data/mutate/{dataset}?returnIds=true&visibility=sync`, `create` | 200 + `results[0].id` (`drafts.` 접두사가 없어 공개 문서) | `error.description` 표시 |
| Wix | `POST ricos/v1/ricos-document/convert/to-ricos`(HTML ≤ 30,000자) → `POST blog/v3/draft-posts`(`memberId`, `seoSlug`, `fieldsets:[URL]`) → `POST …/draft-posts/{id}/publish` | 게시 단계 2xx | 초안을 `DELETE`. 삭제하지 못하면 초안 ID를 알려 준다 |
| Framer | Server API(`framer-api` 5.1, `wss://api.framer.com` 고정): 컬렉션 항목 `addItems` → `publish()` → 배포가 `pending`을 벗어날 때까지 확인 → `deploy()` | 배포 상태 `optimizing`/`ready` | 아래 참고 |
| Payload | `POST {server}/api/{collection}` (`Authorization: {auth컬렉션} API-Key {키}`), `_status: "published"` | 201 + `doc.id` | `errors[0]`과 필드별 오류 표시 |
| WordPress·Shopify | 기존 흐름을 공급자 모듈로 옮겼다(동작·테스트 동일) | 2xx | 기존과 같음 |

- **본문 형식:** 초안 Markdown을 한 번 트리로 파싱한다(`markdown-ast.ts`). 그 트리에서 HTML(기존 출력과 바이트 단위 동일, 픽스처 35개), Sanity Portable Text, Contentful Rich Text(중첩 규칙 준수: 목록·인용·표 셀 안은 문단), Payload Lexical 상태를 만든다. 공급자마다 Markdown, HTML 또는 리치 텍스트 중 하나를 고른다.
- **Framer 안전장치:** Framer 발행은 프로젝트 전체를 게시한다. 그래서 다른 사람의 미발행 페이지 변경이 있으면 발행을 거부하고, 이 글만 공개되도록 한다. 배포가 20초 안에 끝나지 않으면 `published`로 기록하지 않는다(항목은 추가되었다고 알린다). 커스텀 도메인 반영에 실패해도 기본 도메인이 공개 상태면 게시로 본다.
- **URL:** CMS가 돌려준 값만 쓴다(WordPress `link`, Wix `url`, Framer 미발행 경로와 공개 호스트). 그 외에는 사용자가 지정한 자기 도메인의 접두사로만 만든다. 접두사는 브랜드 도메인과 그 하위 도메인만 허용한다.
- **슬러그:** 한글처럼 라틴 문자가 없는 제목은 `article`로 겹쳤다. 이제 콘텐츠 ID 기반 `post-xxxxxxxx`를 쓴다. 내보내기 파일명도 같다.
- **게시일:** Sanity·Payload·Contentful에 선택형 게시일 필드를 두었다(Payload 기본값 `publishedAt`). 프런트엔드가 날짜로 목록을 거르는 템플릿에서 글이 빠지지 않게 하기 위해서다.

## 2. 보안

- **SSRF:**
  - 모든 HTTP 요청은 기존 `safeFetch`(공개 호스트만, 리디렉션 없음)를 거친다.
  - Payload 서버 URL은 https와 사설망 차단 검증을 통과해야 한다.
  - 호스트에 들어가는 값(Sanity 프로젝트 ID, Contentful 리전)은 패턴이나 고정값으로 제한한다.
  - CMS 응답에서 받아 경로에 쓰는 ID는 `safeId`로 거른다.
  - framer-api는 프로젝트 ID를 쿼리 파라미터로만 보낸다. ID는 20자 영숫자로 검증한다.
- **헤더 주입:** 토큰은 공백이 없는 한 줄의 출력 가능 ASCII로 검증한다.
- **비밀값:**
  - `enc:`로 봉인해 저장하고, 화면과 활동 로그에는 마스킹한다.
  - 예전 버전이 평문으로 남긴 토큰은 다음 저장 때 봉인한다.
  - 알 수 없는 레거시 키는 표시하지 않고, 다시 저장할 때 제거한다.
- **권한:** 연결과 발행은 `content:write`, 내보내기는 `content:read`(기존과 같음).

## 3. 적대적 검토에서 찾아 고친 것

| 심각도 | 문제 | 수정 |
|---|---|---|
| HIGH | React 19는 폼 제출 뒤 폼을 자동으로 초기화한다. 이때 제어 컴포넌트인 CMS 선택 상자만 화면에서 WordPress로 돌아가, 두 번째 제출이 엉뚱한 CMS(WordPress)로 저장됐다(브라우저 E2E에서 재현). 오류가 나면 입력한 값도 모두 지워졌다. | 선택 상자를 폼 밖으로 옮기고, 실제 값은 hidden 입력으로 보낸다. 제출은 직접 처리해 오류가 나도 입력을 유지하고, 저장에 성공했을 때만 비운다. |
| HIGH | Framer `publish()`는 배포를 기다리지 않는다. 그런데 `pending` 상태도 게시로 기록했다. | 배포 상태를 확인한 뒤 판정한다. 미완료면 게시로 기록하지 않고 사실대로 안내한다. |
| MEDIUM | 게시 요청이 네트워크 오류로 끝나면(Contentful·Wix) 초안 정리를 시도하지 않고, 초안이 남았다는 사실도 알리지 않았다. Framer는 항목을 추가한 뒤 게시가 실패해도 "거부됨"이라고만 했다. | 응답 없는 게시도 정리 대상으로 처리한다. Framer는 "컬렉션에 추가했지만 게시하지 못함"이라고 알린다. |
| MEDIUM | 날짜 필드가 없으면 Sanity·Payload 템플릿의 목록에서 글이 빠질 수 있었다. | 선택형 게시일 필드를 추가했다. |
| LOW | 플레이스홀더를 번역하면 필드 ID 예시("title", "Blog")가 "제목" 등으로 바뀌어 잘못된 값을 안내했다. 연결 개수가 미완료 연결까지 셌다. 정리 메시지에 마침표가 두 번 찍혔다. | 플레이스홀더는 번역하지 않는다. 개수는 완성된 연결만 센다. 마침표를 정리했다. |

## 4. 검증 증거

- **테스트:** `npx vitest run` → 59개 파일, 345개 테스트 통과(이전 56개 파일, 317개).
  - 새 테스트: 파서 3, HTML 픽스처 1, 리치 텍스트 5, 공급자 16, CMS 통합 2, 번역 1.
  - Red→Green: 구현을 일부러 망가뜨리자 4건이 실패했다(Contentful 버전 헤더, Framer 미발행 변경 검사, Wix 초안 정리). 복원하자 모두 통과했다.
- **타입 체크:** `npx turbo run typecheck --force` → 11/11 성공. framer-api 어댑터의 타입도 공식 타입 정의와 맞는다.
- **빌드:** `@athena/web`·`@athena/marketing`·`@athena/docs` 모두 exit 0(BUILD_ID `AOHsdacKoofRLUc8Lf8Jw`).
  - framer-api는 서버 외부 패키지로 추적된다(`content/page.js.nft.json`).
  - 결과물에 "내보내기 전용", "export for other CMSs" 같은 옛 문구가 없다.
- **브라우저 E2E (격리 DB `athena_r3`, 포트 3300, 한국어 UI):**
  - 연결 패널: 8개 CMS의 필드, 선택 상자 옵션, 안내문이 한국어로 표시된다.
  - 검증 오류: 잘못된 컬렉션 ID와 다른 도메인 접두사는 한국어 오류로 거부되고, 입력값은 유지된다.
  - 저장: Webflow 연결의 토큰이 `enc:`로 저장되고, 기본값 `post-body`가 채워지며, 활동 로그에는 마스킹되어 기록된다.
  - 실제 API 거부(가짜 자격 증명이라 원격에는 아무것도 생기지 않음):
    - Webflow: `HTTP 401: Request not authorized`
    - Sanity: `HTTP 401: Session not found`(프로젝트 서브도메인이 safeFetch를 통과함)
    - Framer: framer-api WebSocket 핸드셰이크에서 `API key does not have access to this project`
  - 세 경우 모두 항목 상태는 `idea` 그대로이고, `published_cms` 기록은 0건이다.
  - 설정 → 연동: 완성된 연결은 "연결됨", 나머지는 "설정"으로 표시된다.
  - 테스트 데이터는 확인 후 삭제했다.

## 5. 한계

- **실계정 성공 경로:** 실제 계정으로 끝까지 성공하는 경로는 검증하지 못했다(사용자 자격 증명이 없음).
  - 성공 경로는 공식 문서의 요청·응답 형태로 만든 단위 테스트로 검증했다.
  - 실제 연결에서 실패하면 CMS의 거부 메시지가 그대로 표시되고 `published`로 기록되지 않는다.
- **Framer:**
  - 미발행 변경 검사와 실제 게시 사이의 짧은 틈에 다른 사람이 바꾼 내용은 함께 게시될 수 있다.
  - 프로젝트에 한 번도 게시된 적이 없으면 거부된다.
  - Node 22 이상이 필요하다(전역 WebSocket). 그래서 `engines`를 `>=22`로 올렸다(Node 20은 2026-04 지원 종료).
- **Webflow:** 리치 텍스트 필드가 지원하지 않는 요소(표 등)는 Webflow가 버릴 수 있다.
- **Portable Text·Lexical:** 표와 코드 블록은 서식 있는 줄로 바꿔 넣는다. 표준 노드가 없기 때문이다.
- **Wix:** 변환 API 제한 때문에 HTML 30,000자를 넘는 초안은 발행 전에 거부한다.
- **Payload:** drafts가 꺼진 컬렉션에서는 `_status`가 무시된다고 가정했다(Payload 문서 기준).
