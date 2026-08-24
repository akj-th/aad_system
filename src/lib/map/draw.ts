// 건물 외곽선 직접 그리기용 좌표 유틸 (WP 방식).
// 대지 중심을 원점으로 하는 로컬 미터 좌표계에서 스냅·표기하고,
// 저장은 경위도 폴리곤(SiteGeometry)으로 되돌린다 — 지오메트리가 진실 원천 (C-3).

import { centroid } from "@turf/turf";
import type { SiteGeometry } from "@/types/project";

export interface LocalFrame {
  /** 원점 경위도 */
  lon0: number;
  lat0: number;
  /** 경도 1도당 미터 (위도 보정) */
  kx: number;
  ky: number;
}

export function makeFrame(origin: SiteGeometry | { lon: number; lat: number }): LocalFrame {
  let lon0: number, lat0: number;
  if ("type" in origin) {
    const c = centroid({ type: "Feature", properties: {}, geometry: origin }).geometry.coordinates;
    [lon0, lat0] = c;
  } else {
    lon0 = origin.lon;
    lat0 = origin.lat;
  }
  return { lon0, lat0, kx: 111_320 * Math.cos((lat0 * Math.PI) / 180), ky: 111_320 };
}

/** 경위도 → 로컬 미터 (동쪽 +x, 북쪽 +y) */
export function toLocal(f: LocalFrame, lon: number, lat: number): [number, number] {
  return [(lon - f.lon0) * f.kx, (lat - f.lat0) * f.ky];
}

/** 로컬 미터 → 경위도 */
export function toLonLat(f: LocalFrame, x: number, y: number): [number, number] {
  return [f.lon0 + x / f.kx, f.lat0 + y / f.ky];
}

/** 그리드 모듈(m)에 스냅. 0이면 스냅 없음 */
export function snap(v: number, module: number): number {
  return module > 0 ? Math.round(v / module) * module : v;
}

/** 로컬 좌표 링 → 경위도 Polygon (닫힌 링으로 만든다) */
export function ringToGeometry(f: LocalFrame, ring: [number, number][]): SiteGeometry {
  const coords = ring.map(([x, y]) => toLonLat(f, x, y));
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) coords.push(first);
  return { type: "Polygon", coordinates: [coords] };
}

/** 신발끈 공식 — 로컬 미터 좌표 폴리곤 면적(㎡) */
export function ringArea(ring: [number, number][]): number {
  if (ring.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/** WP 라벨 — 첫 점을 (0,0)으로 하는 상대 좌표 표기 (CAI의 WP 표기 방식) */
export function wpLabel(ring: [number, number][], i: number): string {
  const [x0, y0] = ring[0];
  const [x, y] = ring[i];
  return `WP${i + 1} (${Math.round(x - x0)}, ${Math.round(y - y0)})`;
}
