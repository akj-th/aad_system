@AGENTS.md
# 프로젝트 규칙

이 프로젝트의 설계 기준은 docs/architecture.md 입니다. 작업 전 반드시 읽으세요.

## 스택
Next.js (App Router) / TypeScript / Tailwind / Zustand

## 절대 규칙
- API 키는 서버 라우트에만. 클라이언트 번들에 절대 노출 금지
- 브이월드 데이터를 서버에 저장·캐싱하지 말 것
- 대지·건물 정보는 전역 변수가 아니라 ProjectState 객체로만 다룰 것
- 브이월드 호출은 SiteDataProvider 인터페이스 뒤에 둘 것
- 확신이 없는 외부 API 문법은 추측하지 말고 물어볼 것

## 명령어
npm run dev / npm run build / npm run lint