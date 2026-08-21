import { create } from "zustand";
import { area as turfArea, union, featureCollection } from "@turf/turf";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import type {
  FeasibilityState,
  FloorArea,
  MassingState,
  MassScenario,
  ModelPlacement,
  Parcel,
  ProgramState,
  ProjectMeta,
  ProjectState,
  ProvenanceEntry,
  RegulationState,
  RenderResult,
  SiteGeometry,
  SiteState,
} from "@/types/project";
import type { CaptureResult } from "@/lib/map/capture";

// B-0 규칙: 모든 모듈은 ProjectState 형식 하나를 읽고 쓴다.
// 이 스토어는 ProjectState의 런타임 표현이며 exportProject()로 직렬화한다.

export const SCHEMA_VERSION = 1;

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

const emptyRegulation: RegulationState = {
  useZone: "",
  useDistrict: [],
  dpUnitPlan: { applies: false, documentRefs: [], conditions: [] },
  bcr: { legal: 0, applied: 0 },
  far: { legal: 0, incentives: [], applied: 0 },
  heightLimit: { type: "", value: 0, basis: "" },
  setbacks: [],
};

const emptyProgram: ProgramState = {
  uses: [],
  grossArea: 0,
  efficiency: 0.75,
  parking: { legal: 0, recommended: 0, basis: "" },
  floorHeight: 3,
};

const emptyFeasibility: FeasibilityState = {
  landCost: 0,
  constructionCost: 0,
  softCost: 0,
  financeCost: 0,
  revenue: { sale: 0, rent: 0 },
  assumptions: { vacancyRate: 0.05, capRate: 0.045, discountRate: 0.06 },
  results: { totalCost: 0, NPV: 0, IRR: 0, ROI: 0 },
};

function newMeta(): ProjectMeta {
  return {
    id: crypto.randomUUID(),
    name: "새 프로젝트",
    createdAt: new Date().toISOString(),
    activeScenarioId: null,
    schemaVersion: SCHEMA_VERSION,
  };
}

/** 한 캡처에서 생성된 AI 리터칭 결과 */
export interface RenderRecord {
  id: string;
  createdAt: string;
  image: string;
  prompt: string;
  options: {
    material: string;
    timeOfDay: string;
    season: string;
    extra?: string;
    useSilhouette?: boolean;
  };
}

/** 2패스 캡처 산출물 + 생성 시각. 내보내기 시 outputs.renders로 변환된다 */
export interface CaptureRecord extends CaptureResult {
  id: string;
  createdAt: string;
  renders: RenderRecord[];
}

/**
 * 파일로 저장되는 형식. ProjectState(정본) + M7 캡처 원본(무손실 복원용).
 * outputs.renders는 captures에서 파생되므로 불러올 때는 m7Captures를 우선한다.
 */
export interface ExportedProject extends ProjectState {
  m7Captures: CaptureRecord[];
}

const MAX_CAPTURES = 5; // dataURL 3장/건이라 메모리 보호를 위해 최근 것만 유지

interface ProjectStore {
  meta: ProjectMeta;
  site: SiteState;
  regulation: RegulationState;
  program: ProgramState;
  feasibility: FeasibilityState;
  massing: MassingState;
  provenance: ProvenanceEntry[];
  captures: CaptureRecord[];

  setProjectName(name: string): void;

  addCapture(result: CaptureResult): void;
  removeCapture(id: string): void;
  addRender(captureId: string, render: Omit<RenderRecord, "id" | "createdAt">): void;

  /** 법규 자동 조회 결과 반영. provenance 기록 포함 */
  setRegulation(patch: Partial<RegulationState>, provenance: ProvenanceEntry[]): void;
  /** 토지특성 조회로 얻은 필지별 공부면적·용도지역 병합 */
  mergeParcelLandInfo(byPnu: Record<string, { officialArea?: number; useZone?: string }>): void;

  updateProgram(patch: Partial<ProgramState>): void;
  updateFeasibility(patch: Partial<FeasibilityState>): void;

  /** 이미 선택된 필지(pnu 일치)면 해제, 아니면 추가 */
  toggleParcel(parcel: Omit<Parcel, "area">): void;
  removeParcel(pnu: string): void;
  clearSite(): void;

  /** glb 업로드 시 호출. modelRef는 파일명 (Blob URL은 세션 한정이라 저장하지 않음) */
  setModel(modelRef: string, placement: ModelPlacement): void;
  updatePlacement(patch: Partial<ModelPlacement>): void;
  clearModel(): void;

  /** 매스 대안 (A-4 시나리오). 활성화하면 program.grossArea를 대안 연면적으로 맞춘다 */
  setScenarios(scenarios: MassScenario[]): void;
  updateScenario(id: string, patch: Partial<MassScenario>): void;
  setActiveScenario(id: string | null): void;
  setFloorTable(table: FloorArea[]): void;

  exportProject(): ExportedProject;
  /** 불러오기. 스키마 버전이 다르면 false 반환 */
  importProject(data: unknown): boolean;
  resetProject(): void;
}

export const useProjectStore = create<ProjectStore>((set, get) => {
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
    meta: newMeta(),
    site: emptySite,
    regulation: emptyRegulation,
    program: emptyProgram,
    feasibility: emptyFeasibility,
    massing: emptyMassing,
    provenance: [],
    captures: [],

    setProjectName: (name) => set((s) => ({ meta: { ...s.meta, name } })),

    setRegulation: (patch, provenance) =>
      set((s) => ({
        regulation: { ...s.regulation, ...patch },
        provenance: [...s.provenance, ...provenance],
      })),
    mergeParcelLandInfo: (byPnu) =>
      set((s) => ({
        site: {
          ...s.site,
          parcels: s.site.parcels.map((p) =>
            byPnu[p.pnu] ? { ...p, ...byPnu[p.pnu] } : p,
          ),
        },
      })),

    updateProgram: (patch) =>
      set((s) => ({ program: { ...s.program, ...patch } })),
    updateFeasibility: (patch) =>
      set((s) => ({ feasibility: { ...s.feasibility, ...patch } })),

    addCapture: (result) =>
      set((s) => ({
        captures: [
          {
            ...result,
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            renders: [],
          },
          ...s.captures,
        ].slice(0, MAX_CAPTURES),
      })),
    addRender: (captureId, render) =>
      set((s) => ({
        captures: s.captures.map((c) =>
          c.id === captureId
            ? {
                ...c,
                renders: [
                  {
                    ...render,
                    id: crypto.randomUUID(),
                    createdAt: new Date().toISOString(),
                  },
                  ...c.renders,
                ],
              }
            : c,
        ),
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

    setScenarios: (scenarios) =>
      set((s) => ({
        massing: { ...s.massing, scenarios, floorTable: [] },
        meta: { ...s.meta, activeScenarioId: null },
      })),
    updateScenario: (id, patch) =>
      set((s) => ({
        massing: {
          ...s.massing,
          scenarios: s.massing.scenarios.map((sc) => (sc.id === id ? { ...sc, ...patch } : sc)),
        },
      })),
    setActiveScenario: (id) =>
      set((s) => {
        const sc = s.massing.scenarios.find((x) => x.id === id);
        return {
          meta: { ...s.meta, activeScenarioId: id },
          program: sc ? { ...s.program, grossArea: Math.round(sc.grossFloorArea) } : s.program,
          massing: { ...s.massing, floorTable: [] },
        };
      }),
    setFloorTable: (floorTable) =>
      set((s) => ({ massing: { ...s.massing, floorTable } })),

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

    exportProject: () => {
      const s = get();
      return {
        meta: s.meta,
        site: s.site,
        regulation: s.regulation,
        program: s.program,
        feasibility: s.feasibility,
        massing: s.massing,
        design: { zoning: [], sketches: [], floorPlans: [], materials: [] },
        outputs: {
          // captures → 정본 스키마(outputs.renders)로 파생
          renders: s.captures.flatMap((c): RenderResult[] =>
            c.renders.length === 0
              ? [
                  {
                    id: c.id,
                    createdAt: c.createdAt,
                    camera: toRenderCamera(c),
                    capture: { beautyImage: c.beauty, maskImage: c.mask },
                    prompt: { material: "", timeOfDay: "", season: "", compiled: "" },
                    resultImages: [],
                    aiGeneratedCaption: true,
                  },
                ]
              : c.renders.map((r) => ({
                  id: r.id,
                  createdAt: r.createdAt,
                  camera: toRenderCamera(c),
                  capture: { beautyImage: c.beauty, maskImage: c.mask },
                  prompt: {
                    material: r.options.material,
                    timeOfDay: r.options.timeOfDay,
                    season: r.options.season,
                    extraInstructions: r.options.extra,
                    compiled: r.prompt,
                  },
                  resultImages: [r.image],
                  selectedImageIndex: 0,
                  aiGeneratedCaption: true,
                })),
          ),
          reports: [],
          drawings: [],
          media: [],
        },
        provenance: s.provenance,
        m7Captures: s.captures,
      };
    },

    importProject: (data) => {
      if (!data || typeof data !== "object") return false;
      const d = data as Partial<ExportedProject>;
      if (!d.meta || d.meta.schemaVersion !== SCHEMA_VERSION || !d.site) {
        return false;
      }
      set({
        meta: d.meta,
        site: d.site,
        regulation: d.regulation ?? emptyRegulation,
        program: { ...emptyProgram, ...d.program },
        feasibility: { ...emptyFeasibility, ...d.feasibility },
        massing: d.massing ?? emptyMassing,
        provenance: d.provenance ?? [],
        captures: d.m7Captures ?? [],
      });
      return true;
    },

    resetProject: () =>
      set({
        meta: newMeta(),
        site: emptySite,
        regulation: emptyRegulation,
        program: emptyProgram,
        feasibility: emptyFeasibility,
        massing: emptyMassing,
        provenance: [],
        captures: [],
      }),
  };
});

function toRenderCamera(c: CaptureRecord) {
  return {
    longitude: c.camera.lon,
    latitude: c.camera.lat,
    height: c.camera.height,
    heading: c.camera.heading,
    pitch: c.camera.pitch,
    roll: c.camera.roll,
  };
}
