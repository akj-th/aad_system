"use client";

import MapViewport from "./MapViewport";
import { useUiStore } from "@/store/ui";

/**
 * 지도 싱글턴 호스트. 루트 레이아웃에 딱 한 번 마운트되어 라우트 이동에도
 * 언마운트되지 않는다 — 브이월드 지도는 재초기화가 불안정하므로 DOM을
 * 파괴하지 않고 visibility/z-index로만 표시 상태를 바꾼다.
 */
export default function MapHost() {
  const mapLayer = useUiStore((s) => s.mapLayer);

  return (
    <div
      className="fixed inset-0"
      style={{
        visibility: mapLayer === "hidden" ? "hidden" : "visible",
        zIndex: mapLayer === "overlay" ? 40 : 0,
      }}
      data-testid="map-host"
      data-map-layer={mapLayer}
    >
      <MapViewport />
    </div>
  );
}
