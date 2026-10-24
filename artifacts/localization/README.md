# 한국어·영어 전환 적용 결과

- 기본 언어: 한국어 (KO)
- 메인 앱: http://localhost:3000/home
- 마케팅: http://localhost:4321 (영어: /en)
- 문서: http://localhost:4322 (영어: /en)
- 상단 EN/KO 선택. 메인 앱은 쿠키에 저장하며 새로고침·화면 이동 시 유지합니다.
- 마케팅·문서 사이트는 언어별 정적 URL을 사용하고 해당 언어로 내부 이동합니다.
- 사용자 입력, 브랜드명, 저장된 원문 콘텐츠와 코드 예시는 원문을 유지합니다.

## 검증

- 웹 테스트: 17개 파일, 51개 테스트 통과
- 메인 앱 TypeScript 검사 및 Next.js 운영 빌드 통과
- 마케팅·문서 운영 빌드: 각 14개 페이지 (한국어 7개 + 영어 7개)
- Ego Lite에서 EN ↔ KO, 새로고침, 페이지 이동 검증
- 언어 전환 시 작성 중인 질문 보존 확인
- 주요 앱 29개 화면의 한국어 렌더링 확인

## 구현 위치

- packages/i18n/src/ko.json: 공통 번역 사전
- packages/i18n/src/locale.ts: 언어 및 쿠키 설정
- apps/web/src/components/locale-provider.tsx: 메인 앱 언어 버튼
- apps/web/src/lib/i18n/server.ts: 서버 언어 처리
- apps/web/src/lib/i18n/i18n.test.ts: 번역·보존·누락 검사
- apps/marketing/src/components/LanguageSwitch.astro: 마케팅 언어 버튼
- apps/docs/src/components/LanguageSwitch.astro: 문서 언어 버튼

routes.json은 첫 전체 화면 점검 기록으로, 이후 발견된 탭·권한 문구를 추가 수정했습니다.
