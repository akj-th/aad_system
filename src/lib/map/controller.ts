// 브이월드/Cesium 뷰어에 대한 명령형 조작 모음 (클라이언트 전용).
// React 상태와 지도의 동기화는 MapViewport가 담당하고, 여기는 순수 지도 조작만 둔다.

import type { Parcel, SiteGeometry, Position } from "@/types/project";

export function getViewer() {
  if (typeof ws3d === "undefined" || !ws3d.viewer) return null;
  return ws3d.viewer;
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

// --- 등고선 ------------------------------------------------------------------

export function setContour(enabled: boolean, spacingMeters: number) {
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
