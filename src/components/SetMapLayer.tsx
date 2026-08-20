"use client";

import { useEffect } from "react";
import { useUiStore, type MapLayer } from "@/store/ui";

/** 페이지 마운트 시 지도 표시 모드를 지정하는 헬퍼 */
export default function SetMapLayer({ layer }: { layer: MapLayer }) {
  const setMapLayer = useUiStore((s) => s.setMapLayer);
  useEffect(() => {
    setMapLayer(layer);
  }, [layer, setMapLayer]);
  return null;
}
