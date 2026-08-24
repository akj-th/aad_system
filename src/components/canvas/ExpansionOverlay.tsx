"use client";

// 노드 더블클릭 시 열리는 확장 뷰.
// 지도(MapHost)는 mapLayer="overlay"로 캔버스 위에 올라오고(z-40),
// 이 컴포넌트는 우측 도구 카드(z-50)와 닫기 버튼만 그린다.
// 닫을 때 지도 스냅샷을 떠서 viewport 노드 썸네일을 갱신한다.

import { useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import BuildingPanel from "@/components/BuildingPanel";
import CapturePanel from "@/components/CapturePanel";
import DrawingsPanel from "@/components/DrawingsPanel";
import FeasibilityPanel from "@/components/FeasibilityPanel";
import MassPanel from "@/components/MassPanel";
import MediaPanel from "@/components/MediaPanel";
import PlanPanel from "@/components/PlanPanel";
import ProgramPanel from "@/components/ProgramPanel";
import RegulationPanel from "@/components/RegulationPanel";
import RenderPanel from "@/components/RenderPanel";
import ReportPanel from "@/components/ReportPanel";
import SitePanel from "@/components/SitePanel";
import ZoningPanel from "@/components/ZoningPanel";
import dynamic from "next/dynamic";
import { useProjectStore } from "@/store/project";
import { useUiStore } from "@/store/ui";
import { snapshotMapThumb } from "./mapThumb";
import { flyTo } from "@/lib/map/controller";
import { getCenter2D } from "@/lib/map/map2d";

// Leaflet은 window가 필요하므로 클라이언트에서만 로드
const SiteMap2D = dynamic(() => import("@/components/SiteMap2D"), { ssr: false });

export default function ExpansionOverlay() {
  const expandedNode = useUiStore((s) => s.expandedNode);
  const expandedKind = useUiStore((s) => s.expandedKind);
  const setExpandedNode = useUiStore((s) => s.setExpandedNode);
  const setMapLayer = useUiStore((s) => s.setMapLayer);
  const setViewportThumb = useUiStore((s) => s.setViewportThumb);
  const captures = useProjectStore((s) => s.captures);
  const drawing = useUiStore((s) => s.footprintDraft !== null);

  const open = expandedNode !== null;

  useEffect(() => {
    if (open) setMapLayer("overlay");
  }, [open, setMapLayer]);

  const close = useCallback(async () => {
    // 2D 필지 지도에서 닫으면 3D 카메라를 같은 위치로 맞춘다
    if (expandedKind === "site") {
      const c = getCenter2D();
      if (c) flyTo(c.lon, c.lat, 600);
    }
    const thumb = await snapshotMapThumb();
    if (thumb) setViewportThumb(thumb);
    setMapLayer("hidden");
    setExpandedNode(null);
  }, [expandedKind, setExpandedNode, setMapLayer, setViewportThumb]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  // capture-<id> / render-<id> 노드에서 대상 캡처를 찾는다
  let captureId: string | undefined;
  if (expandedKind === "capture") {
    captureId = expandedNode!.replace(/^capture-/, "");
  } else if (expandedKind === "render") {
    const renderId = expandedNode!.replace(/^render-/, "");
    captureId = captures.find((c) =>
      c.renders.some((r) => r.id === renderId),
    )?.id;
  }

  // 캔버스 컨테이너(z-10)의 스태킹 컨텍스트에 갇히면 지도(z-40, body 직속)보다
  // 아래에 깔린다 — body로 portal해서 지도 위(z-50)에 띄운다.
  return createPortal(
    <div data-testid="expansion-overlay">
      {/* 대지 노드: 필지 선택은 2D 지도로 (3D 지도 위, 도구 카드 아래) */}
      {expandedKind === "site" && (
        <div className="fixed inset-0 z-[45]">
          <SiteMap2D mode="parcel" />
        </div>
      )}
      {/* 매스: 외곽선을 그리는 동안에만 2D 지도를 띄운다 (그 외에는 3D 매스 확인) */}
      {expandedKind === "mass" && drawing && (
        <div className="fixed inset-0 z-[45]">
          <SiteMap2D mode="footprint" />
        </div>
      )}
      <aside
        className={`fixed inset-y-0 right-0 z-50 flex flex-col gap-6 overflow-y-auto border-l border-zinc-200 bg-white p-4 text-sm shadow-xl ${
          expandedKind === "report" || expandedKind === "drawings"
            ? "w-[62vw] min-w-[640px]"
            : "w-96"
        }`}
      >
        <div className="flex items-center justify-between">
          <button
            className="rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700"
            onClick={() => void close()}
            data-testid="expansion-close"
          >
            ← 캔버스로
          </button>
          <span className="text-[10px] text-zinc-400">Esc로 닫기</span>
        </div>

        {expandedKind === "site" && <SitePanel />}
        {expandedKind === "regulation" && <RegulationPanel />}
        {expandedKind === "program" && <ProgramPanel />}
        {expandedKind === "feasibility" && <FeasibilityPanel />}
        {expandedKind === "report" && <ReportPanel />}
        {expandedKind === "building" && <BuildingPanel />}
        {expandedKind === "mass" && <MassPanel />}
        {expandedKind === "zoning" && <ZoningPanel />}
        {expandedKind === "plan" && <PlanPanel />}
        {expandedKind === "drawings" && <DrawingsPanel />}
        {expandedKind === "media" && <MediaPanel />}
        {expandedKind === "viewport" && (
          <>
            <SitePanel />
            <hr className="border-zinc-200" />
            <BuildingPanel />
            <hr className="border-zinc-200" />
            <CapturePanel />
          </>
        )}
        {expandedKind === "capture" && (
          <>
            <CapturePanel captureId={captureId} />
            <hr className="border-zinc-200" />
            {/* 첫 렌더 생성 진입점 — 여기서 생성하면 render 노드가 붙는다 */}
            <RenderPanel captureId={captureId} />
          </>
        )}
        {expandedKind === "render" && <RenderPanel captureId={captureId} />}
      </aside>
    </div>,
    document.body,
  );
}
