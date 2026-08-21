"use client";

import { useEffect, useState } from "react";
import { useProjectStore } from "@/store/project";
import {
  drawMass,
  drawSite,
  onLeftClick,
  pickLonLat,
  registerMap,
  setSun,
  updateBuildingModel,
} from "@/lib/map/controller";
import type { ParcelFeature } from "@/app/api/vworld/parcel/route";

// vw.Map에는 destroy가 없어 StrictMode 재마운트 시 재초기화하면 안 된다.
let mapStarted = false;

const MAP_CONTAINER_ID = "map";

export default function MapViewport() {
  const [scriptMissing, setScriptMissing] = useState(false);
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

  // 지도 클릭 → 필지 조회 → 선택 토글
  useEffect(() => {
    if (scriptMissing) return;
    const { toggleParcel } = useProjectStore.getState();

    return onLeftClick(async (x, y) => {
      const lonlat = pickLonLat(x, y);
      if (!lonlat) return;
      try {
        const res = await fetch(
          `/api/vworld/parcel?lon=${lonlat.lon}&lat=${lonlat.lat}`,
        );
        const json = (await res.json()) as { parcel: ParcelFeature | null };
        if (json.parcel?.pnu) {
          toggleParcel({
            pnu: json.parcel.pnu,
            jimok: "",
            geometry: json.parcel.geometry,
            jibun: json.parcel.jibun,
            addr: json.parcel.addr,
            jiga: json.parcel.jiga ?? undefined,
          });
        }
      } catch {
        // 필지 조회 실패는 치명적이지 않다 — 클릭 무시
      }
    });
  }, [scriptMissing]);

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

  return <div id={MAP_CONTAINER_ID} className="h-full w-full" />;
}
