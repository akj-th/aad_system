"use client";

// 2D 필지 선택 지도 (Leaflet). 브이월드 기본지도/항공사진 타일(프록시) 위에
// 화면 범위의 연속지적도 필지를 벡터로 올리고, 클릭으로 선택/해제한다.
// next/dynamic(ssr:false)로만 불러올 것 — Leaflet은 window가 필요하다.

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { centroid } from "@turf/turf";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { useProjectStore } from "@/store/project";
import { getCenter2D, registerMap2D, rememberCenter2D } from "@/lib/map/map2d";
import { cameraCenterLonLat } from "@/lib/map/controller";
import type { SiteGeometry } from "@/types/project";

const MIN_PARCEL_ZOOM = 17;
/** 서버(parcels 라우트)와 같은 값 — 넘으면 요청하지 않고 안내만 한다 */
const MAX_SPAN_DEG = 0.025;

interface ParcelProps {
  pnu?: string;
  jibun?: string;
  addr?: string;
  jiga?: string;
}

const baseStyle: L.PathOptions = { color: "#1d4ed8", weight: 1, fillColor: "#1d4ed8", fillOpacity: 0.04 };
const selectedStyle: L.PathOptions = { color: "#1d4ed8", weight: 1.5, fillColor: "#3b82f6", fillOpacity: 0.4 };
const boundaryStyle: L.PathOptions = { color: "#f97316", weight: 3, fill: false };

export default function SiteMap2D() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const parcelsRef = useRef<L.GeoJSON | null>(null);
  const boundaryRef = useRef<L.GeoJSON | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const site = useProjectStore((s) => s.site);

  // 지도 초기화 (1회)
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const saved = getCenter2D();
    let center: [number, number] = [37.5665, 126.978];
    let zoom = 17;
    if (site.boundary) {
      const c = centroid({ type: "Feature", properties: {}, geometry: site.boundary }).geometry.coordinates;
      center = [c[1], c[0]];
      zoom = 18;
    } else if (saved) {
      center = [saved.lat, saved.lon];
      zoom = saved.zoom;
    } else {
      const cam = cameraCenterLonLat();
      if (cam) center = [cam.lat, cam.lon];
    }

    const map = L.map(containerRef.current, { center, zoom, zoomControl: true, attributionControl: true });
    const base = L.tileLayer("/api/vworld/tile/Base/{z}/{y}/{x}", { maxZoom: 19, attribution: "© 브이월드 / 국토교통부" });
    const satellite = L.tileLayer("/api/vworld/tile/Satellite/{z}/{y}/{x}", { maxZoom: 19, attribution: "© 브이월드 / 국토교통부" });
    const hybrid = L.tileLayer("/api/vworld/tile/Hybrid/{z}/{y}/{x}", { maxZoom: 19 });
    satellite.addTo(map);
    hybrid.addTo(map);
    L.control.layers({ 항공사진: satellite, 기본지도: base }, { "명칭(하이브리드)": hybrid }, { position: "topleft" }).addTo(map);

    const { toggleParcel } = useProjectStore.getState();
    const parcels = L.geoJSON(undefined, {
      style: (f) => (isSelected(f?.properties?.pnu) ? selectedStyle : baseStyle),
      onEachFeature: (feature, layer) => {
        const p = feature.properties as ParcelProps;
        layer.bindTooltip(`${p.jibun ?? ""}${p.addr ? ` · ${p.addr}` : ""}`, { sticky: true, direction: "top" });
        layer.on("click", () => {
          if (!p.pnu) return;
          toggleParcel({
            pnu: p.pnu,
            jimok: "",
            geometry: feature.geometry as SiteGeometry,
            jibun: p.jibun,
            addr: p.addr,
            jiga: p.jiga ? Number(p.jiga) : undefined,
          });
        });
      },
    }).addTo(map);
    const boundary = L.geoJSON(undefined, { style: boundaryStyle, interactive: false }).addTo(map);

    mapRef.current = map;
    parcelsRef.current = parcels;
    boundaryRef.current = boundary;
    registerMap2D(map);

    let abort: AbortController | null = null;
    const load = async () => {
      const z = map.getZoom();
      if (z < MIN_PARCEL_ZOOM) {
        parcels.clearLayers();
        setStatus(`필지를 보려면 확대하세요 (현재 z${z}, 최소 z${MIN_PARCEL_ZOOM})`);
        return;
      }
      abort?.abort();
      abort = new AbortController();
      const b = map.getBounds();
      if (b.getEast() - b.getWest() > MAX_SPAN_DEG || b.getNorth() - b.getSouth() > MAX_SPAN_DEG) {
        parcels.clearLayers();
        setStatus("범위가 넓습니다 — 확대하세요");
        return;
      }
      setStatus("필지 불러오는 중…");
      try {
        const res = await fetch(
          `/api/vworld/parcels?bbox=${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`,
          { signal: abort.signal },
        );
        const fc = (await res.json()) as FeatureCollection | { error: string; tooLarge?: boolean };
        if ("error" in fc) {
          setStatus(fc.tooLarge ? "범위가 넓습니다 — 확대하세요" : fc.error);
          return;
        }
        parcels.clearLayers();
        parcels.addData(fc);
        setStatus(`필지 ${fc.features.length}개 · 클릭해 선택/해제`);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setStatus("필지 조회 실패");
      }
    };
    map.on("moveend", load);
    void load();

    return () => {
      rememberCenter2D();
      registerMap2D(null);
      map.off("moveend", load);
      map.remove();
      mapRef.current = null;
    };
    // 초기화는 마운트 시 1회 — site 변경은 아래 효과가 처리
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function isSelected(pnu?: string) {
    return !!pnu && useProjectStore.getState().site.parcels.some((p) => p.pnu === pnu);
  }

  function setStatus(text: string) {
    if (statusRef.current) statusRef.current.textContent = text;
  }

  // 선택 상태 → 스타일·경계 갱신
  useEffect(() => {
    const parcels = parcelsRef.current;
    const boundary = boundaryRef.current;
    if (!parcels || !boundary) return;
    parcels.eachLayer((layer) => {
      const f = (layer as L.GeoJSON).feature as Feature | undefined;
      const pnu = (f?.properties as ParcelProps | undefined)?.pnu;
      (layer as L.Path).setStyle(isSelected(pnu) ? selectedStyle : baseStyle);
    });
    boundary.clearLayers();
    if (site.boundary) {
      boundary.addData({ type: "Feature", properties: {}, geometry: site.boundary } as Feature<Polygon | MultiPolygon>);
    }
  }, [site]);

  return (
    <div className="relative h-full w-full" data-testid="site-map-2d">
      <div ref={containerRef} className="h-full w-full" />
      <div
        ref={statusRef}
        className="pointer-events-none absolute bottom-3 left-1/2 z-[1000] -translate-x-1/2 rounded bg-white/90 px-3 py-1 text-xs text-zinc-700 shadow"
        data-testid="site-map-status"
      />
    </div>
  );
}
