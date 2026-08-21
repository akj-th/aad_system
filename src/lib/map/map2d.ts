// 2D 필지 선택 지도(Leaflet) 인스턴스 홀더. 패널에서 명령형으로 이동시키기 위한 얇은 레이어.
import type { Map as LeafletMap } from "leaflet";

let map: LeafletMap | null = null;
let lastCenter: { lon: number; lat: number; zoom: number } | null = null;

export function registerMap2D(m: LeafletMap | null) {
  map = m;
}

export function setView2D(lon: number, lat: number, zoom = 18) {
  lastCenter = { lon, lat, zoom };
  map?.setView([lat, lon], zoom);
}

export function getCenter2D(): { lon: number; lat: number; zoom: number } | null {
  if (map) {
    const c = map.getCenter();
    return { lon: c.lng, lat: c.lat, zoom: map.getZoom() };
  }
  return lastCenter;
}

export function rememberCenter2D() {
  const c = getCenter2D();
  if (c) lastCenter = c;
}
