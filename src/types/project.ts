// docs/architecture.md Part A-2 스키마의 TypeScript 선언.
// 이 모듈(M7)이 실제로 읽고 쓰는 필드는 site, massing.modelRef, outputs.renders뿐이지만,
// 다른 모듈(M1~M6, M8~M10)이 상태를 공유해야 하므로 전체 스키마를 먼저 확정한다.

// --- 공용 지오메트리 -------------------------------------------------------
// @types/geojson 의존성을 아직 추가하지 않았으므로 필요한 최소 형태만 선언한다.

type Position = [number, number] | [number, number, number]

interface GeoJSONPolygon {
  type: 'Polygon'
  coordinates: Position[][]
}

// --- 근거 추적 --------------------------------------------------------------

/** 지구단위계획 지침 PDF 등 원문 출처 (A-6) */
interface DocRef {
  title: string
  url?: string
  page?: number
}

type ProvenanceSource = 'ai_estimate' | 'legal_document' | 'user_input' | 'calculated'

/**
 * 상태 안의 모든 숫자·판단의 근거. A-2에서 "이 필드가 시스템의 신뢰도를 결정한다"고
 * 명시되어 있으므로 값의 출처(AI 추정/법령 원문/수동 입력/계산)를 항상 함께 기록한다.
 */
interface ProvenanceEntry {
  /** ProjectState 내 대상 필드의 dot-path, 예: "regulation.far.legal" */
  field: string
  value: unknown
  source: ProvenanceSource
  /** 근거 설명, 예: "OO시 도시계획조례 제OO조" */
  basis?: string
  documentRef?: DocRef
  timestamp: string
}

// --- site (M1) --------------------------------------------------------------

interface Parcel {
  pnu: string
  jimok: string
  area: number
  geometry: GeoJSONPolygon
}

interface RoadFrontage {
  width: number
  side: string
}

interface SlopeInfo {
  min: number
  max: number
  avg: number
}

interface SiteState {
  parcels: Parcel[]
  /** 단필 / 합필 / 임의 경계 (A-2) */
  operation: 'single' | 'merge' | 'custom'
  /** 최종 대지 경계 (합필·개발 후 결과) */
  boundary: GeoJSONPolygon | null
  area: number
  roads: RoadFrontage[]
  slope: SlopeInfo
  notes: string
}

// --- regulation (M2) ---------------------------------------------------------

interface DPUnitPlanCondition {
  id: string
  description: string
  source: DocRef
}

interface DPUnitPlan {
  applies: boolean
  documentRefs: DocRef[]
  conditions: DPUnitPlanCondition[]
}

interface BuildingCoverageRatio {
  legal: number
  applied: number
}

interface Incentive {
  name: string
  value: number
  basis: string
}

interface FloorAreaRatio {
  legal: number
  incentives: Incentive[]
  applied: number
}

interface HeightLimit {
  type: string
  value: number
  basis: string
}

interface Setback {
  direction: string
  distance: number
  basis: string
}

interface RegulationState {
  useZone: string
  useDistrict: string[]
  dpUnitPlan: DPUnitPlan
  bcr: BuildingCoverageRatio
  far: FloorAreaRatio
  heightLimit: HeightLimit
  setbacks: Setback[]
}

// --- program (M2/M3 입력) -----------------------------------------------------

interface ProgramUse {
  code: string
  name: string
  ratio: number
}

interface UnitMixEntry {
  type: string
  count: number
  exclusiveArea: number
}

interface ParkingRequirement {
  legal: number
  recommended: number
  basis: string
}

interface ProgramState {
  uses: ProgramUse[]
  grossArea: number
  unitMix?: UnitMixEntry[]
  efficiency: number
  parking: ParkingRequirement
}

// --- feasibility (M3) ---------------------------------------------------------

interface FeasibilityAssumptions {
  vacancyRate: number
  capRate: number
  discountRate: number
  [key: string]: number
}

interface FeasibilityResults {
  totalCost: number
  NPV: number
  IRR: number
  ROI: number
}

interface FeasibilityState {
  landCost: number
  constructionCost: number
  softCost: number
  financeCost: number
  revenue: { sale: number; rent: number }
  assumptions: FeasibilityAssumptions
  results: FeasibilityResults
}

// --- massing (M4) ---------------------------------------------------------

interface MassScenario {
  id: string
  name: string
  description?: string
  floors: number
  floorHeight: number
  grossFloorArea: number
  bcr: number
  far: number
  createdAt: string
}

interface FloorArea {
  floor: number
  use: string
  area: number
}

interface MassingState {
  scenarios: MassScenario[]
  floorTable: FloorArea[]
  /** SketchUp 등에서 뽑은 glb 참조. M7이 이 필드를 소비한다 */
  modelRef?: string
}

// --- design (M5/M6) ---------------------------------------------------------
// M5(조닝·스케치), M6(평면)는 아직 상세 설계 전이므로(A-7) 필드 형태만 선언해둔다.

interface DesignState {
  zoning: unknown[]
  sketches: unknown[]
  floorPlans: unknown[]
  materials: unknown[]
}

// --- outputs (M7~M10) ---------------------------------------------------------

interface RenderCamera {
  longitude: number
  latitude: number
  height: number
  heading: number
  pitch: number
  roll: number
}

interface RenderCapture {
  /** A패스 — 뷰티 캡처 (AI 입력) */
  beautyImage: string
  /** B패스 — 실루엣 캡처 (마스크용) */
  maskImage: string
}

interface RenderPrompt {
  material: string
  timeOfDay: string
  season: string
  mood?: string
  extraInstructions?: string
  /** B-4 Phase 4 템플릿으로 조립된 최종 프롬프트 */
  compiled: string
}

/** Phase 3~5의 산출물. 카메라 좌표·프롬프트·시각·이미지를 기록한다 (B-0) */
interface RenderResult {
  id: string
  createdAt: string
  camera: RenderCamera
  capture: RenderCapture
  prompt: RenderPrompt
  /** 한 번에 2~3장 생성되는 변형 결과 */
  resultImages: string[]
  selectedImageIndex?: number
  /** "AI 생성 — 실제 설계안과 재질·주변 환경이 다를 수 있음" 캡션 표시 여부 (B-5) */
  aiGeneratedCaption?: boolean
}

// M9(리포트), M8(도면), M10(미디어)는 아직 상세 설계 전이므로(A-7) 필드 형태만 선언해둔다.
interface OutputsState {
  renders: RenderResult[]
  reports: unknown[]
  drawings: unknown[]
  media: unknown[]
}

// --- meta / scenario --------------------------------------------------------

interface ProjectMeta {
  id: string
  name: string
  createdAt: string
  activeScenarioId: string | null
}

// --- ProjectState ------------------------------------------------------------

/**
 * 시스템 전체의 단일 진실 원천 (A-1, A-2).
 * 모든 모듈은 이 상태를 읽어 자기 산출물을 만들고 다시 이 상태에 기록한다.
 */
export interface ProjectState {
  meta: ProjectMeta
  site: SiteState
  regulation: RegulationState
  program: ProgramState
  feasibility: FeasibilityState
  massing: MassingState
  design: DesignState
  outputs: OutputsState
  provenance: ProvenanceEntry[]
}

export type {
  Position,
  GeoJSONPolygon,
  DocRef,
  ProvenanceSource,
  ProvenanceEntry,
  Parcel,
  RoadFrontage,
  SlopeInfo,
  SiteState,
  DPUnitPlanCondition,
  DPUnitPlan,
  BuildingCoverageRatio,
  Incentive,
  FloorAreaRatio,
  HeightLimit,
  Setback,
  RegulationState,
  ProgramUse,
  UnitMixEntry,
  ParkingRequirement,
  ProgramState,
  FeasibilityAssumptions,
  FeasibilityResults,
  FeasibilityState,
  MassScenario,
  FloorArea,
  MassingState,
  DesignState,
  RenderCamera,
  RenderCapture,
  RenderPrompt,
  RenderResult,
  OutputsState,
  ProjectMeta,
}
