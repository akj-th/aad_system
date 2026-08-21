"use client";

// 노드 카드 5종 — 요약만 표시. 내용은 zustand에서 직접 읽어 store 변경 시
// 노드 배열 재구성 없이도 카드가 갱신된다.

import type { Node, NodeProps } from "@xyflow/react";
import { useShallow } from "zustand/react/shallow";
import NodeCard from "./NodeCard";
import { useProjectStore } from "@/store/project";
import { useUiStore } from "@/store/ui";
import { PARKING_CATEGORIES } from "@/lib/regulation/parking";

function formatArea(sqm: number): string {
  return `${sqm.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}㎡`;
}

export type CaptureNodeType = Node<{ captureId: string }, "capture">;
export type RenderNodeType = Node<
  { captureId: string; renderId: string },
  "render"
>;

export function SiteNode() {
  const site = useProjectStore((s) => s.site);
  return (
    <NodeCard kind="site" title={site.parcels[0]?.addr ?? "필지 미선택"}>
      {site.parcels.length === 0 ? (
        <p className="text-zinc-400">더블클릭해 필지를 선택하세요</p>
      ) : (
        <>
          <p>
            {site.operation === "merge"
              ? `합필 ${site.parcels.length}필지`
              : "단필"}{" "}
            · <strong>{formatArea(site.area)}</strong>
          </p>
          <p className="truncate text-[10px] text-zinc-400">
            {site.parcels.map((p) => p.jibun).join(", ")}
          </p>
        </>
      )}
    </NodeCard>
  );
}

export function RegulationNode() {
  const regulation = useProjectStore((s) => s.regulation);
  const site = useProjectStore((s) => s.site);
  const lastSiteChangeAt = useUiStore((s) => s.lastSiteChangeAt);
  const stale =
    !!regulation.fetchedAt &&
    new Date(regulation.fetchedAt).getTime() < lastSiteChangeAt;

  const baseArea = site.parcels.reduce(
    (sum, p) => sum + (p.officialArea ?? p.area),
    0,
  );
  const maxGross = (baseArea * regulation.far.applied) / 100;

  return (
    <NodeCard
      kind="regulation"
      title={regulation.useZone || "용도지역 미조회"}
      stale={stale}
    >
      {!regulation.useZone ? (
        <p className="text-zinc-400">필지를 선택하면 자동 조회됩니다</p>
      ) : (
        <>
          <p>
            건폐율 {regulation.bcr.applied}% · 용적률 {regulation.far.applied}%
          </p>
          <p className="text-[10px] text-zinc-400">
            최대 연면적 {formatArea(maxGross)} (공부면적 기준)
          </p>
        </>
      )}
    </NodeCard>
  );
}

export function ProgramNode() {
  const program = useProjectStore((s) => s.program);
  // 법정 최대 연면적 초과 여부 (공부면적 × 적용 용적률)
  const maxGross = useProjectStore((s) => {
    const base = s.site.parcels.reduce((sum, p) => sum + (p.officialArea ?? p.area), 0);
    return (base * s.regulation.far.applied) / 100;
  });
  const over = maxGross > 0 && program.grossArea > maxGross + 0.5;
  return (
    <NodeCard
      kind="program"
      title={program.uses.length ? `${program.uses.length}개 용도` : "용도 미설정"}
      badge={over ? "법정 연면적 초과" : undefined}
    >
      {program.grossArea === 0 ? (
        <p className="text-zinc-400">법규 조회 후 더블클릭해 용도를 구성하세요</p>
      ) : (
        <>
          <p>
            연면적 {formatArea(program.grossArea)} · 주차{" "}
            <strong>{program.parking.legal}대</strong>
          </p>
          <p className="truncate text-[10px] text-zinc-400">
            {program.uses
              .map(
                (u) =>
                  `${PARKING_CATEGORIES.find((c) => c.code === u.code)?.short ?? u.code} ${u.ratio}%`,
              )
              .join(", ") || "—"}
          </p>
        </>
      )}
    </NodeCard>
  );
}

function won(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  return `${n < 0 ? "-" : ""}${(abs / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}억`;
}

export function FeasibilityNode() {
  const feasibility = useProjectStore((s) => s.feasibility);
  const grossArea = useProjectStore((s) => s.program.grossArea);
  const r = feasibility.results;
  return (
    <NodeCard kind="feasibility" title={grossArea ? `총사업비 ${won(r.totalCost)}` : "미산정"}>
      {!grossArea ? (
        <p className="text-zinc-400">규모 확정 후 더블클릭해 가정을 입력하세요</p>
      ) : (
        <>
          <p>
            ROI <strong className={r.ROI < 0 ? "text-red-600" : ""}>{(r.ROI * 100).toFixed(1)}%</strong>{" "}
            · IRR {r.IRR === 0 && r.ROI !== 0 ? "—" : `${(r.IRR * 100).toFixed(1)}%`}
          </p>
          <p className="text-[10px] text-zinc-400">
            NPV {won(r.NPV)} (할인율 {(feasibility.assumptions.discountRate * 100).toFixed(1)}%)
          </p>
        </>
      )}
    </NodeCard>
  );
}

export function ReportNode() {
  // 객체를 돌려주는 셀렉터는 useShallow로 감싸야 매 변경마다 리렌더 루프가 안 생긴다
  const ready = useProjectStore(
    useShallow((s) => ({
      site: s.site.parcels.length > 0,
      regulation: !!s.regulation.useZone,
      program: s.program.grossArea > 0,
      feasibility: s.feasibility.results.totalCost > 0,
      renders: s.captures.reduce((n, c) => n + c.renders.length, 0),
    })),
  );
  const done = [ready.site, ready.regulation, ready.program, ready.feasibility].filter(Boolean).length;
  return (
    <NodeCard kind="report" title="기획 검토 리포트">
      <p>
        섹션 준비 {done}/4 · 렌더 {ready.renders}건
      </p>
      <p className="text-[10px] text-zinc-400">
        {[
          ready.site && "대지",
          ready.regulation && "법규",
          ready.program && "규모",
          ready.feasibility && "사업성",
        ]
          .filter(Boolean)
          .join(" · ") || "더블클릭해 미리보기"}
      </p>
    </NodeCard>
  );
}

export function BuildingNode() {
  const massing = useProjectStore((s) => s.massing);
  const p = massing.placement;
  return (
    <NodeCard kind="building" title={massing.modelRef ?? "모델 없음"}>
      {!p ? (
        <p className="text-zinc-400">더블클릭해 glb를 올리세요</p>
      ) : (
        <>
          <p>
            heading {p.heading.toFixed(0)}° · ×{p.scale.toFixed(2)}
          </p>
          <p className="text-[10px] text-zinc-400">
            고도 {(p.baseHeight + p.heightOffset).toFixed(1)}m (오프셋{" "}
            {p.heightOffset.toFixed(1)})
          </p>
        </>
      )}
    </NodeCard>
  );
}

export function ViewportNode() {
  const thumb = useUiStore((s) => s.viewportThumb);
  return (
    <NodeCard kind="viewport" title="브이월드 3D">
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumb}
          alt="3D 뷰 썸네일"
          className="h-28 w-full rounded object-cover"
          data-testid="viewport-thumb"
        />
      ) : (
        <div className="flex h-28 w-full items-center justify-center rounded bg-zinc-100 text-zinc-400">
          더블클릭해 지도 열기
        </div>
      )}
    </NodeCard>
  );
}

export function CaptureNode({ data }: NodeProps<CaptureNodeType>) {
  const capture = useProjectStore((s) =>
    s.captures.find((c) => c.id === data.captureId),
  );
  const lastUpstreamChangeAt = useUiStore((s) => s.lastUpstreamChangeAt);
  if (!capture) return null;
  const stale = new Date(capture.createdAt).getTime() < lastUpstreamChangeAt;

  return (
    <NodeCard
      kind="capture"
      title={new Date(capture.createdAt).toLocaleTimeString("ko-KR")}
      stale={stale}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={capture.beauty}
        alt="뷰티 캡처"
        className="h-28 w-full rounded object-cover"
      />
      <p className="mt-1 text-[10px] text-zinc-400">
        고도 {capture.camera.height.toFixed(0)}m · pitch{" "}
        {capture.camera.pitch.toFixed(0)}° · 렌더 {capture.renders.length}건
      </p>
    </NodeCard>
  );
}

export function RenderNode({ data }: NodeProps<RenderNodeType>) {
  const capture = useProjectStore((s) =>
    s.captures.find((c) => c.id === data.captureId),
  );
  const lastUpstreamChangeAt = useUiStore((s) => s.lastUpstreamChangeAt);
  const render = capture?.renders.find((r) => r.id === data.renderId);
  if (!capture || !render) return null;
  const stale = new Date(capture.createdAt).getTime() < lastUpstreamChangeAt;

  return (
    <NodeCard
      kind="render"
      title={render.options.material.slice(0, 24)}
      stale={stale}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={render.image}
        alt="렌더 결과"
        className="h-28 w-full rounded object-cover"
      />
      <p className="mt-1 text-[10px] text-zinc-400">
        {render.options.timeOfDay} · {render.options.season}
        {render.options.useSilhouette && " · 실루엣"}
      </p>
    </NodeCard>
  );
}
