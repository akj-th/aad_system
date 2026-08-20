"use client";

// 노드 카드 5종 — 요약만 표시. 내용은 zustand에서 직접 읽어 store 변경 시
// 노드 배열 재구성 없이도 카드가 갱신된다.

import type { Node, NodeProps } from "@xyflow/react";
import NodeCard from "./NodeCard";
import { useProjectStore } from "@/store/project";
import { useUiStore } from "@/store/ui";

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
