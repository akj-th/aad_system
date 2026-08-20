// UI 전용 상태 (노드 캔버스·지도 표시 모드). ProjectState와 분리 — 저장 대상 아님.
import { create } from "zustand";

/**
 * 지도는 단일 인스턴스를 layout(MapHost)에 두고 절대 언마운트하지 않는다.
 *  - base: 구 UI(/)에서 화면 바탕으로 표시
 *  - overlay: 노드 확장 뷰에서 캔버스 위로 표시
 *  - hidden: 캔버스 화면 (visibility로만 숨김 — WebGL 컨텍스트 유지)
 */
export type MapLayer = "base" | "overlay" | "hidden";

export type NodeKind = "site" | "building" | "viewport" | "capture" | "render";

interface UiStore {
  mapLayer: MapLayer;
  setMapLayer(layer: MapLayer): void;

  /** 확장 뷰로 열린 노드 id (null=닫힘) */
  expandedNode: string | null;
  expandedKind: NodeKind | null;
  setExpandedNode(id: string | null, kind?: NodeKind | null): void;

  /** viewport 노드 카드에 보여줄 마지막 지도 썸네일 */
  viewportThumb: string | null;
  setViewportThumb(dataUrl: string | null): void;

  // stale 판정용: 상류(대지·건물배치)가 마지막으로 바뀐 시각 (epoch ms).
  // ProjectState를 수정하지 않기 위해 UI에서 구독으로 추적한다.
  lastUpstreamChangeAt: number;
  markUpstreamChange(): void;
}

export const useUiStore = create<UiStore>((set) => ({
  mapLayer: "hidden",
  setMapLayer: (mapLayer) => set({ mapLayer }),

  expandedNode: null,
  expandedKind: null,
  setExpandedNode: (expandedNode, expandedKind = null) =>
    set({ expandedNode, expandedKind }),

  viewportThumb: null,
  setViewportThumb: (viewportThumb) => set({ viewportThumb }),

  lastUpstreamChangeAt: 0,
  markUpstreamChange: () => set({ lastUpstreamChangeAt: Date.now() }),
}));
