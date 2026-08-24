"use client";

// 2D 지도 (Leaflet). 브이월드 기본지도/항공사진 타일(프록시) 위에서
//  - parcel 모드: 화면 범위의 연속지적도 필지를 벡터로 올리고 클릭으로 선택/해제
//  - footprint 모드: 대지 위에 건물 외곽선을 직접 그린다 (그리드 스냅 + WP 좌표 라벨)
// next/dynamic(ssr:false)로만 불러올 것 — Leaflet은 window가 필요하다.

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { centroid } from "@turf/turf";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { useProjectStore } from "@/store/project";
import { useUiStore } from "@/store/ui";
import { getCenter2D, registerMap2D, rememberCenter2D } from "@/lib/map/map2d";
import { cameraCenterLonLat } from "@/lib/map/controller";
import { makeFrame, ringArea, snap, toLocal, toLonLat, wpLabel, type LocalFrame } from "@/lib/map/draw";
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

export default function SiteMap2D({ mode = "parcel" }: { mode?: "parcel" | "footprint" }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const parcelsRef = useRef<L.GeoJSON | null>(null);
  const boundaryRef = useRef<L.GeoJSON | null>(null);
  const drawLayerRef = useRef<L.LayerGroup | null>(null);
  const frameRef = useRef<LocalFrame | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const site = useProjectStore((s) => s.site);
  const footprintDraft = useUiStore((s) => s.footprintDraft);
  const gridModule = useUiStore((s) => s.gridModule);
  const modeRef = useRef(mode);
  modeRef.current = mode;

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
          // footprint 모드에서는 필지가 배경 — 클릭은 드로잉이 받는다
          if (modeRef.current !== "parcel" || !p.pnu) return;
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

    const drawLayer = L.layerGroup().addTo(map);

    mapRef.current = map;
    parcelsRef.current = parcels;
    boundaryRef.current = boundary;
    drawLayerRef.current = drawLayer;
    registerMap2D(map);

    // 드로잉: 지도 클릭 → 그리드 스냅된 꼭짓점 추가
    map.on("click", (e: L.LeafletMouseEvent) => {
      const ui = useUiStore.getState();
      if (modeRef.current !== "footprint" || ui.footprintDraft === null) return;
      const f = frameRef.current;
      if (!f) return;
      const [x, y] = toLocal(f, e.latlng.lng, e.latlng.lat);
      ui.addVertex([snap(x, ui.gridModule), snap(y, ui.gridModule)]);
    });

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
      // 로컬 좌표계 원점 = 대지 중심 (드로잉·스냅 기준)
      frameRef.current = makeFrame(site.boundary);
    }
  }, [site]);

  // footprint 모드 진입 시 대지가 화면에 꽉 차게 맞춘다
  useEffect(() => {
    const map = mapRef.current;
    const boundary = boundaryRef.current;
    if (mode !== "footprint" || !map || !boundary) return;
    const b = boundary.getBounds();
    if (b.isValid()) map.fitBounds(b, { padding: [80, 80], maxZoom: 20 });
  }, [mode]);

  // 드로잉 중인 외곽선 렌더 — 꼭짓점 마커 + WP 좌표 라벨 + 면적
  useEffect(() => {
    const layer = drawLayerRef.current;
    const f = frameRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (mode !== "footprint" || !footprintDraft || !f) return;

    const latlngs = footprintDraft.map(([x, y]) => {
      const [lon, lat] = toLonLat(f, x, y);
      return [lat, lon] as [number, number];
    });

    if (latlngs.length >= 3) {
      L.polygon(latlngs, { color: "#dc2626", weight: 2, fillColor: "#dc2626", fillOpacity: 0.15 }).addTo(layer);
    } else if (latlngs.length === 2) {
      L.polyline(latlngs, { color: "#dc2626", weight: 2 }).addTo(layer);
    }

    latlngs.forEach((ll, i) => {
      L.circleMarker(ll, { radius: 4, color: "#dc2626", fillColor: "#fff", fillOpacity: 1, weight: 2 })
        .addTo(layer)
        .bindTooltip(wpLabel(footprintDraft, i), {
          permanent: true,
          direction: "top",
          offset: [0, -6],
          className: "!bg-white/90 !border-zinc-300 !text-[10px] !px-1 !py-0",
        });
    });

    const area = ringArea(footprintDraft);
    setStatus(
      footprintDraft.length < 3
        ? `외곽선 그리기 — 지도를 클릭해 꼭짓점 추가 (${footprintDraft.length}점, 스냅 ${gridModule}m)`
        : `건축면적 ${area.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}㎡ · ${footprintDraft.length}점 · 스냅 ${gridModule}m`,
    );
  }, [footprintDraft, gridModule, mode]);

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
