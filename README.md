# AAD System — 건축 설계 토탈 시스템 (1차 구현)

하나의 프로젝트 상태(`ProjectState`)를 여러 모듈이 읽고 쓰는 **노드 캔버스** 기반 건축 기획 도구.
설계 문서는 [docs/architecture.md](docs/architecture.md)를 먼저 읽을 것.

## 구현 범위 (2026-08 기준)

| 모듈 | 상태 | 비고 |
|---|---|---|
| M1 대지 | ✅ | 주소 검색, 연속지적도 필지 선택, 합필(turf union), 공부면적 병기 |
| M2 법규 계산부 | ✅ | 용도지역 자동 조회, 건폐율·용적률·면적, 주차 대수, 정북일조 개략 — 전부 결정론 |
| M3 사업성 | ✅ | 공시지가 기반 토지비, 비용·수입, ROI/NPV/IRR |
| M7 뷰포트·렌더 | ✅ | 브이월드 3D, glb 배치, 2패스 캡처, Gemini 리터칭(형태 보존) |
| M9 리포트 | ✅ | 결정론 HTML, 인쇄/PDF, provenance 목록 |
| M4·M5·M6·M8·M10 | ⏳ | 스키마만 선언 |

## 실행

```bash
cp .env.example .env.local   # 키 입력
npm install
npm run dev                  # http://localhost:3000
```

### 브이월드 인증키와 도메인 (중요)

브이월드 인증키는 **도메인이 함께 등록**된다. 로컬은 `localhost`로 등록된 키를 쓰고,
배포할 때는 배포 도메인을 브이월드 개발자센터에 **별도 등록**해야 지도가 뜬다.
(`VWORLD_DOMAIN`은 서버측 REST 호출의 Referer에도 쓰인다.)

지도 스크립트 자체는 브라우저가 직접 로드하므로 지도용 키는 URL에 노출된다 — 이는 브이월드 구조상 불가피하며 도메인 등록으로 보호된다. 검색·지적·토지특성 등 REST 호출은 전부 `app/api/vworld/*` 서버 프록시를 경유한다(CORS + 키 보호).

## 구조

```
src/
  types/project.ts          ProjectState 스키마 (단일 진실 원천)
  store/project.ts          zustand 런타임 상태 + 내보내기/불러오기
  store/ui.ts               캔버스·지도 표시 모드, stale 추적
  data/regulations/*.json   법규 수치 — 코드가 아니라 데이터 (지자체 추가 = 파일 추가)
  lib/regulation/           건폐율·용적률·주차·일조 계산기 (결정론)
  lib/feasibility/calc.ts   사업성 계산기 (결정론)
  lib/report/html.ts        리포트 HTML 생성기 (결정론)
  lib/map/                  Cesium/브이월드 조작, 2패스 캡처
  lib/server/               브이월드 REST 헬퍼, ImageProvider(Gemini)
  app/api/                  서버 프록시 라우트 (키는 여기서만)
  components/canvas/        React Flow 노드 캔버스, 확장 뷰, 지도 싱글턴
  components/*Panel.tsx     모듈별 도구 패널 (확장 뷰 내용물)
```

### 핵심 원칙 (architecture.md A-5)

- **계산은 코드, 판단은 AI.** 법규·면적·주차·사업성은 전부 결정론 코드이며 AI를 호출하지 않는다.
- **근거 없는 숫자 없음.** 조회·계산값은 조문/출처와 함께 `provenance`에 기록되고 UI·리포트에 병기된다.
- **형태는 3D가 결정, AI는 리터칭만.** 2패스 캡처(뷰티+실루엣)로 형태를 고정한다.
- 모든 산출물은 "참고용 검토이며 최종 확인은 담당 건축사 책임".

### 지도 인스턴스

브이월드 지도는 재초기화가 불안정하므로 `MapHost`가 루트 레이아웃에 한 번만 마운트하고,
캔버스/확장 뷰 전환은 `visibility`·`z-index`로만 처리한다 (DOM 파괴 금지).
뷰어는 `requestRenderMode`라 캡처 시 `requestRender()`를 직접 호출한다.

## 법규 데이터 추가

`src/data/regulations/`:

- `national.json` — 국계법 시행령 §84·§85 상한
- `seoul.json` — 서울시 도시계획 조례 §54·§55 (4대문 안 차등 미반영)
- `parking.json` — 주차장법 시행령 별표1 / 서울시 주차장 조례 별표2
- `sunlight.json` — 건축법 시행령 §86 정북일조

다른 지자체는 `seoul.json`과 같은 형식으로 `jurisdictionPrefix`를 주소 접두어로 두고 파일을 추가한 뒤
`lib/regulation/calc.ts`의 `LOCAL_TABLES`(또는 `parking.json`의 `tables`)에 넣는다.

## 제약·주의

- 브이월드 DEM/지형 데이터는 **서버에 저장·캐싱하지 않는다** (국토부 보안관리규정). 실시간 요청만.
- 렌더 시 대지 이미지가 Gemini로 전송된다. **발주처 비밀유지 약정을 먼저 확인**할 것 (architecture.md C-5).
- A패스 무광 흰색 처리는 **텍스처로만 표현된 창호를 지운다.** 개구부 보존이 필요하면 창호가 지오메트리인 모델을 쓸 것.
- 공부면적은 토지특성 API(토지대장) 기준, 도형면적은 병기용.

## 상태 파일

캔버스 툴바의 내보내기는 `ProjectState` 정본 + M7 캡처 원본(`m7Captures`)을 `*.aad.json`으로 저장한다.
불러오기는 `meta.schemaVersion`이 일치해야 하며, glb 파일은 다시 올려야 한다(배치값은 유지).
