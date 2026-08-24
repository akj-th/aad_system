"use client";

import { useEffect, useState } from "react";
import { useProjectStore } from "@/store/project";
import {
  drawMass,
  drawSite,
  installRenderErrorRecovery,
  registerMap,
  setSun,
  updateBuildingModel,
} from "@/lib/map/controller";

// vw.Map에는 destroy가 없어 StrictMode 재마운트 시 재초기화하면 안 된다.
let mapStarted = false;

const MAP_CONTAINER_ID = "map";

export default function MapViewport() {
  const [scriptMissing, setScriptMissing] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const site = useProjectStore((s) => s.site);
  const placement = useProjectStore((s) => s.massing.placement);
  const activeMass = useProjectStore((s) =>
    s.massing.scenarios.find((sc) => sc.id === s.meta.activeScenarioId),
  );

  useEffect(() => {
    if (mapStarted) return;

    if (typeof vw === "undefined") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 외부 스크립트 로드 여부는 마운트 후에만 알 수 있다
      setScriptMissing(true);
      return;
    }
    mapStarted = true;

    const map = new vw.Map();
    map.setOption({
      mapId: "vmap",
      initPosition: new vw.CameraPosition(
        new vw.CoordZ(127.024612, 37.5326, 3000),
        new vw.Direction(0, -90, 0),
      ),
      logo: true,
      navigation: true,
    });
    map.setMapId(MAP_CONTAINER_ID);
    map.start();
    registerMap(map);

    // 시계를 당일 14:00으로 고정 — 안 하면 캡처(그림자 on)가 실제 시각 태양을
    // 써서 저녁에 캡처하면 A패스가 어둡게 나온다. 패널 기본값과도 일치시킨다.
    const noon = new Date();
    noon.setHours(14, 0, 0, 0);
    setSun(noon, false);

    if (process.env.NODE_ENV === "development") {
      // 브라우저 자동 검증용 (프로덕션 번들에는 제외됨)
      (window as unknown as Record<string, unknown>).__projectStore =
        useProjectStore;
    }
  }, []);

  // 렌더 에러(주로 무거운/깨진 glb) 복구 — 모델을 걷어내고 지도를 되살린다
  useEffect(() => {
    if (scriptMissing) return;
    return installRenderErrorRecovery((message) => {
      useProjectStore.getState().clearModel();
      setRenderError(
        `3D 모델을 그리는 중 오류가 발생해 모델을 제거했습니다. 지도는 계속 사용할 수 있습니다.\n${message}`,
      );
    });
  }, [scriptMissing]);

  // 필지 선택은 2D 지도(SiteMap2D)에서 한다 — 3D 클릭 선택은 궤도 조작과 충돌해 제거.

  // 선택 상태 → 지도 하이라이트 동기화
  useEffect(() => {
    if (scriptMissing) return;
    drawSite(site.parcels, site.boundary);
  }, [site, scriptMissing]);

  // 건물 모델 배치 동기화
  useEffect(() => {
    if (scriptMissing) return;
    updateBuildingModel(placement);
  }, [placement, scriptMissing]);

  // 활성 매스 대안 → 압출 폴리곤
  useEffect(() => {
    if (scriptMissing) return;
    drawMass(activeMass?.footprint ?? null, activeMass?.height ?? 0);
  }, [activeMass, scriptMissing]);

  if (scriptMissing) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-zinc-100 p-8 text-center">
        <div className="max-w-md space-y-2">
          <p className="text-lg font-semibold text-zinc-900">
            브이월드 지도 스크립트를 불러오지 못했습니다
          </p>
          <p className="text-sm text-zinc-600">
            .env.local의 VWORLD_API_KEY가 유효한지, 해당 인증키에 현재
            도메인(localhost)이 등록되어 있는지 확인하세요.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div id={MAP_CONTAINER_ID} className="h-full w-full" />
      {renderError && (
        <div
          className="absolute left-1/2 top-4 z-[60] w-[520px] max-w-[90vw] -translate-x-1/2 rounded-lg border border-red-300 bg-white p-3 shadow-lg"
          data-testid="render-error-banner"
        >
          <p className="text-sm font-semibold text-red-700">3D 모델 렌더 오류</p>
          <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-600">{renderError}</p>
          <p className="mt-1 text-[11px] text-zinc-500">
            SketchUp에서 내보낸 glb는 그룹·컴포넌트 중첩이 깊으면 렌더가 멈출 수 있습니다.
            내보내기 전에 그룹을 풀거나(Explode) 병합해 다시 시도해 보세요.
          </p>
          <button
            className="mt-2 rounded bg-zinc-900 px-2 py-1 text-xs text-white"
            onClick={() => setRenderError(null)}
          >
            닫기
          </button>
        </div>
      )}
    </div>
  );
}
