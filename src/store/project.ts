import { create } from "zustand";
import { area as turfArea, union, featureCollection } from "@turf/turf";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import type {
  MassingState,
  ModelPlacement,
  Parcel,
  SiteGeometry,
  SiteState,
} from "@/types/project";
import type { CaptureResult } from "@/lib/map/capture";

// B-0 규칙: 대지 정보는 ProjectState 형식으로만 다룬다. 지금은 site만 실사용하고
// 나머지 필드는 이후 Phase에서 채운다.

const emptySite: SiteState = {
  parcels: [],
  operation: "single",
  boundary: null,
  area: 0,
  roads: [],
  slope: { min: 0, max: 0, avg: 0 },
  notes: "",
};

function computeBoundary(parcels: Parcel[]): SiteGeometry | null {
  if (parcels.length === 0) return null;
  const features = parcels.map(
    (p) =>
      ({
        type: "Feature",
        properties: {},
        geometry: p.geometry,
      }) as Feature<Polygon | MultiPolygon>,
  );
  if (features.length === 1) return parcels[0].geometry;
  const merged = union(featureCollection(features));
  return (merged?.geometry as SiteGeometry) ?? null;
}

const emptyMassing: MassingState = {
  scenarios: [],
  floorTable: [],
};

/** 2패스 캡처 산출물 + 생성 시각. Phase 5에서 outputs.renders로 승격된다 */
export interface CaptureRecord extends CaptureResult {
  id: string;
  createdAt: string;
}

const MAX_CAPTURES = 5; // dataURL 3장/건이라 메모리 보호를 위해 최근 것만 유지

interface ProjectStore {
  site: SiteState;
  massing: MassingState;
  captures: CaptureRecord[];
  addCapture(result: CaptureResult): void;
  removeCapture(id: string): void;
  /** 이미 선택된 필지(pnu 일치)면 해제, 아니면 추가 */
  toggleParcel(parcel: Omit<Parcel, "area">): void;
  removeParcel(pnu: string): void;
  clearSite(): void;
  /** glb 업로드 시 호출. modelRef는 파일명 (Blob URL은 세션 한정이라 저장하지 않음) */
  setModel(modelRef: string, placement: ModelPlacement): void;
  updatePlacement(patch: Partial<ModelPlacement>): void;
  clearModel(): void;
}

export const useProjectStore = create<ProjectStore>((set) => {
  const rebuild = (parcels: Parcel[]): SiteState => {
    const boundary = computeBoundary(parcels);
    return {
      ...emptySite,
      parcels,
      boundary,
      operation: parcels.length > 1 ? "merge" : "single",
      area: boundary
        ? turfArea({ type: "Feature", properties: {}, geometry: boundary })
        : 0,
    };
  };

  return {
    site: emptySite,
    massing: emptyMassing,
    captures: [],
    addCapture: (result) =>
      set((s) => ({
        captures: [
          {
            ...result,
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
          },
          ...s.captures,
        ].slice(0, MAX_CAPTURES),
      })),
    removeCapture: (id) =>
      set((s) => ({ captures: s.captures.filter((c) => c.id !== id) })),
    setModel: (modelRef, placement) =>
      set((s) => ({ massing: { ...s.massing, modelRef, placement } })),
    updatePlacement: (patch) =>
      set((s) =>
        s.massing.placement
          ? {
              massing: {
                ...s.massing,
                placement: { ...s.massing.placement, ...patch },
              },
            }
          : s,
      ),
    clearModel: () =>
      set((s) => ({
        massing: { ...s.massing, modelRef: undefined, placement: undefined },
      })),
    toggleParcel: (incoming) =>
      set((s) => {
        const exists = s.site.parcels.some((p) => p.pnu === incoming.pnu);
        const parcels = exists
          ? s.site.parcels.filter((p) => p.pnu !== incoming.pnu)
          : [
              ...s.site.parcels,
              {
                ...incoming,
                // 지목은 jibun 끝의 비숫자 문자에서 추출 (예: "31대" → "대")
                jimok: incoming.jibun?.match(/[^\d-]+$/)?.[0] ?? "",
                area: turfArea({
                  type: "Feature",
                  properties: {},
                  geometry: incoming.geometry,
                }),
              },
            ];
        return { site: rebuild(parcels) };
      }),
    removeParcel: (pnu) =>
      set((s) => ({
        site: rebuild(s.site.parcels.filter((p) => p.pnu !== pnu)),
      })),
    clearSite: () => set({ site: emptySite }),
  };
});
