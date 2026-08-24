// 브이월드/Cesium 뷰어에 대한 명령형 조작 모음 (클라이언트 전용).
// React 상태와 지도의 동기화는 MapViewport가 담당하고, 여기는 순수 지도 조작만 둔다.

import type {
  ModelPlacement,
  Parcel,
  SiteGeometry,
  Position,
} from "@/types/project";

export function getViewer() {
  if (typeof ws3d === "undefined" || !ws3d.viewer) return null;
  return ws3d.viewer;
}

// vw.Map 인스턴스. 지금은 개발용 디버깅 노출만 하고, 레이어 API가 필요해지면 보관한다.
export function registerMap(map: vw.Map) {
  if (process.env.NODE_ENV === "development") {
    (window as unknown as Record<string, unknown>).__vwMap = map;
  }
}

export function flyTo(lon: number, lat: number, height = 1200) {
  const viewer = getViewer();
  if (!viewer) return;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(-90),
      roll: 0,
    },
    duration: 1.5,
  });
}

/** 화면 좌표 → 지형 위 경위도 */
export function pickLonLat(x: number, y: number): { lon: number; lat: number } | null {
  const viewer = getViewer();
  if (!viewer) return null;
  const ray = viewer.camera.getPickRay(new Cesium.Cartesian2(x, y));
  if (!ray) return null;
  const cartesian = viewer.scene.globe.pick(ray, viewer.scene);
  if (!cartesian) return null;
  const carto = Cesium.Cartographic.fromCartesian(cartesian);
  return {
    lon: Cesium.Math.toDegrees(carto.longitude),
    lat: Cesium.Math.toDegrees(carto.latitude),
  };
}

export interface CameraPose {
  lon: number;
  lat: number;
  height: number;
  /** 도 단위 */
  heading: number;
  pitch: number;
  roll: number;
}

export function getCameraPose(): CameraPose | null {
  const viewer = getViewer();
  if (!viewer) return null;
  const camera = viewer.camera;
  const carto = camera.positionCartographic;
  return {
    lon: Cesium.Math.toDegrees(carto.longitude),
    lat: Cesium.Math.toDegrees(carto.latitude),
    height: carto.height,
    heading: Cesium.Math.toDegrees(camera.heading),
    pitch: Cesium.Math.toDegrees(camera.pitch),
    roll: Cesium.Math.toDegrees(camera.roll),
  };
}

export function onLeftClick(handler: (x: number, y: number) => void): () => void {
  const viewer = getViewer();
  if (!viewer) return () => {};
  const h = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  h.setInputAction(
    (movement: { position: { x: number; y: number } }) =>
      handler(movement.position.x, movement.position.y),
    Cesium.ScreenSpaceEventType.LEFT_CLICK,
  );
  return () => h.destroy();
}

// --- 필지·경계 하이라이트 ----------------------------------------------------

function polygonsOf(geometry: SiteGeometry): Position[][][] {
  return geometry.type === "Polygon"
    ? [geometry.coordinates]
    : geometry.coordinates;
}

function toHierarchy(rings: Position[][]) {
  const [outer, ...holes] = rings;
  return new Cesium.PolygonHierarchy(
    Cesium.Cartesian3.fromDegreesArray(outer.flatMap(([x, y]) => [x, y])),
    holes.map(
      (h) =>
        new Cesium.PolygonHierarchy(
          Cesium.Cartesian3.fromDegreesArray(h.flatMap(([x, y]) => [x, y])),
        ),
    ),
  );
}

/** 선택 필지(채움)와 합필 경계(외곽선)를 다시 그린다 */
export function drawSite(parcels: Parcel[], boundary: SiteGeometry | null) {
  const viewer = getViewer();
  if (!viewer) return;
  const entities = viewer.entities;

  // 우리가 그린 엔티티만 지운다
  entities.values
    .filter((e: { id: string }) => String(e.id).startsWith("aad-site-"))
    .forEach((e: unknown) => entities.remove(e));

  parcels.forEach((parcel, i) => {
    polygonsOf(parcel.geometry).forEach((rings, j) => {
      entities.add({
        id: `aad-site-parcel-${i}-${j}`,
        polygon: {
          hierarchy: toHierarchy(rings),
          material: Cesium.Color.fromCssColorString("#3b82f6").withAlpha(0.35),
          classificationType: Cesium.ClassificationType.TERRAIN,
        },
      });
    });
  });

  if (boundary) {
    polygonsOf(boundary).forEach((rings, j) => {
      const outer = rings[0];
      entities.add({
        id: `aad-site-boundary-${j}`,
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(
            [...outer, outer[0]].flatMap(([x, y]) => [x, y]),
          ),
          width: 4,
          material: Cesium.Color.fromCssColorString("#f97316"),
          clampToGround: true,
        },
      });
    });
  }
}

// --- 건물 glb 모델 -----------------------------------------------------------

const MODEL_ENTITY_ID = "aad-building-model";
let modelBlobUrl: string | null = null;

/** 화면(캔버스) 중앙의 지형 위 경위도 */
export function cameraCenterLonLat(): { lon: number; lat: number } | null {
  const viewer = getViewer();
  if (!viewer) return null;
  const canvas = viewer.scene.canvas;
  return pickLonLat(canvas.clientWidth / 2, canvas.clientHeight / 2);
}

/** 해당 좌표의 지형 고도(타원체 기준 m). 타일 미로드 시 null */
export function terrainHeightAt(lon: number, lat: number): number | null {
  const viewer = getViewer();
  if (!viewer) return null;
  const h = viewer.scene.globe.getHeight(
    Cesium.Cartographic.fromDegrees(lon, lat),
  );
  return typeof h === "number" ? h : null;
}

/** 현재 세션에 glb가 로드돼 있는지 (불러오기 후엔 배치값만 있고 파일은 없다) */
export function hasBuildingModelUrl(): boolean {
  return modelBlobUrl !== null;
}

/** glb Blob URL 등록. 배치 갱신은 updateBuildingModel이 담당 */
export function setBuildingModelUrl(blobUrl: string | null) {
  const viewer = getViewer();
  if (!viewer) return;
  if (modelBlobUrl && modelBlobUrl !== blobUrl) {
    URL.revokeObjectURL(modelBlobUrl);
  }
  modelBlobUrl = blobUrl;
  const existing = viewer.entities.getById(MODEL_ENTITY_ID);
  if (existing) viewer.entities.remove(existing);
}

export function updateBuildingModel(placement: ModelPlacement | undefined) {
  const viewer = getViewer();
  if (!viewer) return;
  const existing = viewer.entities.getById(MODEL_ENTITY_ID);

  if (!placement || !modelBlobUrl) {
    if (existing) viewer.entities.remove(existing);
    return;
  }

  const position = Cesium.Cartesian3.fromDegrees(
    placement.lon,
    placement.lat,
    placement.baseHeight + placement.heightOffset,
  );
  const orientation = Cesium.Transforms.headingPitchRollQuaternion(
    position,
    new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(placement.heading), 0, 0),
  );

  if (existing) {
    existing.position = position;
    existing.orientation = orientation;
    existing.model.scale = placement.scale;
  } else {
    viewer.entities.add({
      id: MODEL_ENTITY_ID,
      position,
      orientation,
      model: {
        uri: modelBlobUrl,
        scale: placement.scale,
        shadows: Cesium.ShadowMode.ENABLED,
      },
    });
  }
}

export function flyToModel() {
  const viewer = getViewer();
  if (!viewer) return;
  const entity = viewer.entities.getById(MODEL_ENTITY_ID);
  if (entity) viewer.flyTo(entity, { duration: 1.2 });
}

// --- 매스 (규칙 기반 대안) ----------------------------------------------------

export const MASS_ENTITY_ID = "aad-mass";

/** 활성 매스 대안을 지형 위에 압출 폴리곤으로 표출. null이면 제거 */
export function drawMass(footprint: SiteGeometry | null, height: number) {
  const viewer = getViewer();
  if (!viewer) return;
  const existing = viewer.entities.values.filter((e: { id: string }) =>
    String(e.id).startsWith(MASS_ENTITY_ID),
  );
  existing.forEach((e: unknown) => viewer.entities.remove(e));
  if (!footprint) return;

  polygonsOf(footprint).forEach((rings, j) => {
    viewer.entities.add({
      id: `${MASS_ENTITY_ID}-${j}`,
      polygon: {
        hierarchy: toHierarchy(rings),
        height: 0,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        extrudedHeight: height,
        extrudedHeightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        material: Cesium.Color.fromCssColorString("#a78bfa").withAlpha(0.75),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString("#5b21b6"),
        shadows: Cesium.ShadowMode.ENABLED,
      },
    });
  });
}

export function flyToMass() {
  const viewer = getViewer();
  if (!viewer) return;
  const entities = viewer.entities.values.filter((e: { id: string }) =>
    String(e.id).startsWith(MASS_ENTITY_ID),
  );
  if (entities.length) viewer.flyTo(entities, { duration: 1.2 });
}

// --- 뷰포인트 프리셋 ----------------------------------------------------------
// CAI는 렌더 이미지를 다른 시점으로 "변환"하지만, 우리는 3D 카메라를 실제로 옮겨
// 다시 캡처한다 — 시점이 바뀌어도 형태·주변 맥락의 정합이 유지된다 (C-3).

export type ViewpointKind = "bird" | "corner" | "front" | "street" | "detail";

export const VIEWPOINTS: { kind: ViewpointKind; label: string; desc: string }[] = [
  { kind: "bird", label: "조감", desc: "대지 전체와 주변 맥락" },
  { kind: "corner", label: "코너", desc: "가로 모서리에서 본 2면" },
  { kind: "front", label: "정면", desc: "주 접도 방향 정면" },
  { kind: "street", label: "스트리트", desc: "보행자 눈높이" },
  { kind: "detail", label: "디테일", desc: "저층부 근접" },
];

interface ViewpointSpec {
  /** 건물 높이 대비 카메라 거리 배수 (바닥 반경에 더해진다) */
  rangeFactor: number;
  /** 최소 이격(m) — 건물 외피에서 이만큼은 떨어진다 */
  minStandoff: number;
  pitchDeg: number;
  /** 정면(0) 기준 상대 방위각 */
  headingOffset: number;
  /** 주시점 높이 = 건물 높이 × 이 값 */
  targetHeightFactor: number;
  /** 보행자 시점 등 고정 주시 높이(m) */
  eyeHeight?: number;
}

const SPECS: Record<ViewpointKind, ViewpointSpec> = {
  bird: { rangeFactor: 2.6, minStandoff: 40, pitchDeg: -45, headingOffset: -30, targetHeightFactor: 0.5 },
  corner: { rangeFactor: 1.6, minStandoff: 30, pitchDeg: -20, headingOffset: -45, targetHeightFactor: 0.45 },
  front: { rangeFactor: 1.6, minStandoff: 30, pitchDeg: -12, headingOffset: 0, targetHeightFactor: 0.45 },
  // 도심에서 진짜 보행자 눈높이는 옆 건물에 가려지므로, 저층부가 보이는 낮은 근경으로 잡는다
  street: { rangeFactor: 0.8, minStandoff: 60, pitchDeg: -10, headingOffset: -15, targetHeightFactor: 0.3, eyeHeight: 12 },
  detail: { rangeFactor: 0.5, minStandoff: 35, pitchDeg: -8, headingOffset: -20, targetHeightFactor: 0.25 },
};

export interface ViewpointTarget {
  lon: number;
  lat: number;
  /** 건물 높이(m) */
  height: number;
  /** 바닥 외접 반경(m) — 카메라가 건물 안에 박히지 않도록 이격의 기준이 된다 */
  footprintRadius?: number;
  /** 정면으로 삼을 방위각(도). 미지정 시 남측(180) */
  frontHeading?: number;
}

/** 프리셋 시점으로 카메라를 이동시킨다 (즉시 반영, 캡처 직전 사용) */
export function setViewpoint(kind: ViewpointKind, t: ViewpointTarget) {
  const viewer = getViewer();
  if (!viewer) return;
  const spec = SPECS[kind];
  const h = Math.max(6, t.height);
  const radius = Math.max(8, t.footprintRadius ?? 15);
  // 바닥 반경 밖으로 나간 뒤 시점별 이격을 더한다 (건물 내부 진입 방지)
  const range = radius + Math.max(spec.minStandoff, h * spec.rangeFactor);
  const heading = ((t.frontHeading ?? 180) + spec.headingOffset) % 360;

  const terrain = terrainHeightAt(t.lon, t.lat) ?? 0;
  const targetHeight = spec.eyeHeight
    ? terrain + spec.eyeHeight
    : terrain + h * spec.targetHeightFactor;

  viewer.camera.lookAt(
    Cesium.Cartesian3.fromDegrees(t.lon, t.lat, targetHeight),
    new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(heading),
      Cesium.Math.toRadians(spec.pitchDeg),
      range,
    ),
  );
  // lookAt은 카메라를 변환에 고정한다 — 이후 자유 조작을 위해 해제
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  viewer.scene.requestRender();
}

// --- 태양·그림자 -------------------------------------------------------------

// 브이월드는 태양과 무관한 고정 광원을 쓴다 (런타임 확인). 그림자를 켜면
// SunLight로 교체해 시각에 따라 빛이 움직이게 하고, 끄면 원래 광원으로 되돌린다.
let vworldDefaultLight: unknown = null;

// 패널이 리마운트돼도 지도의 실제 표시 상태를 되읽을 수 있도록 모듈에 보관한다
const displayState = {
  sun: { date: new Date(), shadows: false },
  contour: { enabled: false, spacing: 5 },
};

export function getSunState() {
  return { ...displayState.sun };
}
export function getContourState() {
  return { ...displayState.contour };
}
export function getBuildingsVisible(): boolean {
  return layerVisibility.buildings;
}

export function setSun(date: Date, shadowsEnabled: boolean) {
  displayState.sun = { date, shadows: shadowsEnabled };
  const viewer = getViewer();
  if (!viewer) return;
  const scene = viewer.scene;

  viewer.clock.currentTime = Cesium.JulianDate.fromDate(date);
  viewer.clock.shouldAnimate = false;

  if (shadowsEnabled && !(scene.light instanceof Cesium.SunLight)) {
    vworldDefaultLight = scene.light;
    scene.light = new Cesium.SunLight();
  } else if (!shadowsEnabled && vworldDefaultLight) {
    scene.light = vworldDefaultLight;
    vworldDefaultLight = null;
  }

  viewer.shadowMap.enabled = shadowsEnabled;
  viewer.shadowMap.size = 2048;
  viewer.shadowMap.softShadows = true;
  scene.globe.enableLighting = shadowsEnabled;
  scene.globe.shadows = shadowsEnabled
    ? Cesium.ShadowMode.RECEIVE_ONLY
    : Cesium.ShadowMode.DISABLED;
}

// --- 지도 표시 옵션: 주변 3D 건물 · 명칭(POI) ---------------------------------

// 런타임 introspection으로 확인된 브이월드 타일셋 구조:
//  - 3D 건물·시설물: cdn.vworld.kr/TDServer/services/map4/* (Cesium3DTileset)
//  - 지도 명칭·POI 아이콘: cdn.vworld.kr/TDServer/services/poi/* (Cesium3DTileset)
// 카메라 이동에 따라 타일셋이 늦게 추가될 수 있어, 숨김 상태면 매 프레임 강제한다.
const layerVisibility = { buildings: true, labels: true };
let enforceRemover: (() => void) | null = null;

function tilesetKind(p: unknown): "buildings" | "labels" | null {
  if (!(p instanceof Cesium.Cesium3DTileset)) return null;
  const url = String((p as { _url?: unknown })._url ?? "");
  if (url.includes("/TDServer/services/map4/")) return "buildings";
  if (url.includes("/TDServer/services/poi/")) return "labels";
  return null;
}

function applyLayerVisibility() {
  const viewer = getViewer();
  if (!viewer) return;
  const primitives = viewer.scene.primitives;
  for (let i = 0; i < primitives.length; i++) {
    const p = primitives.get(i);
    const kind = tilesetKind(p);
    if (kind) p.show = layerVisibility[kind];
  }
}

function setLayerVisibility(kind: "buildings" | "labels", visible: boolean) {
  const viewer = getViewer();
  if (!viewer) return;
  layerVisibility[kind] = visible;
  applyLayerVisibility();
  const anyHidden = !layerVisibility.buildings || !layerVisibility.labels;
  if (anyHidden && !enforceRemover) {
    enforceRemover = viewer.scene.postUpdate.addEventListener(
      applyLayerVisibility,
    );
  } else if (!anyHidden && enforceRemover) {
    enforceRemover();
    enforceRemover = null;
  }
}

export function setBuildingsVisible(visible: boolean) {
  setLayerVisibility("buildings", visible);
}

/** 지도 명칭·POI 아이콘 표시 토글 */
export function setLabelsVisible(visible: boolean) {
  setLayerVisibility("labels", visible);
}

export function getLabelsVisible(): boolean {
  return layerVisibility.labels;
}

// --- 등고선 ------------------------------------------------------------------

export function setContour(enabled: boolean, spacingMeters: number) {
  displayState.contour = { enabled, spacing: spacingMeters };
  const viewer = getViewer();
  if (!viewer) return;
  const globe = viewer.scene.globe;
  if (!enabled) {
    globe.material = undefined;
    return;
  }
  const material = Cesium.Material.fromType("ElevationContour");
  material.uniforms.spacing = spacingMeters;
  material.uniforms.width = 1.5;
  material.uniforms.color =
    Cesium.Color.fromCssColorString("#b45309").withAlpha(0.7);
  globe.material = material;
}
