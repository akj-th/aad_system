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
