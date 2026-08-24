"use client";

import { Handle, Position } from "@xyflow/react";
import type { ReactNode } from "react";
import type { NodeKind } from "@/store/ui";

const KIND_LABEL: Record<NodeKind, string> = {
  site: "대지",
  regulation: "법규",
  program: "규모",
  feasibility: "사업성",
  report: "리포트",
  mass: "매스",
  zoning: "조닝",
  plan: "평면",
  drawings: "도면·BIM",
  media: "미디어",
  building: "건물",
  viewport: "3D 뷰",
  capture: "캡처",
  render: "렌더",
};

const KIND_COLOR: Record<NodeKind, string> = {
  site: "bg-blue-600",
  regulation: "bg-rose-600",
  program: "bg-teal-600",
  feasibility: "bg-orange-600",
  report: "bg-slate-700",
  mass: "bg-fuchsia-600",
  zoning: "bg-lime-600",
  plan: "bg-cyan-700",
  drawings: "bg-stone-700",
  media: "bg-pink-600",
  building: "bg-violet-600",
  viewport: "bg-zinc-700",
  capture: "bg-amber-600",
  render: "bg-emerald-600",
};

export default function NodeCard({
  kind,
  title,
  stale = false,
  badge,
  onDownload,
  onDelete,
  children,
}: {
  kind: NodeKind;
  title: string;
  stale?: boolean;
  /** stale 외의 경고 배지 (예: "법정 초과") */
  badge?: string;
  /** 호버 액션 — 산출물 노드(캡처·렌더)에서만 쓴다 */
  onDownload?: () => void;
  onDelete?: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={`group relative w-60 rounded-lg border border-zinc-200 bg-white shadow-sm transition-opacity ${
        stale ? "opacity-50" : ""
      }`}
      data-testid={`node-${kind}`}
    >
      {(onDownload || onDelete) && (
        <div className="absolute -top-3 right-1 z-10 hidden gap-1 group-hover:flex">
          {onDownload && (
            <button
              className="rounded bg-white px-1.5 py-0.5 text-[11px] shadow ring-1 ring-zinc-200 hover:bg-zinc-50"
              onClick={(e) => {
                e.stopPropagation();
                onDownload();
              }}
              title="다운로드"
              data-testid="node-download"
            >
              ⤓
            </button>
          )}
          {onDelete && (
            <button
              className="rounded bg-white px-1.5 py-0.5 text-[11px] text-red-600 shadow ring-1 ring-zinc-200 hover:bg-red-50"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              title="삭제"
              data-testid="node-delete"
            >
              ✕
            </button>
          )}
        </div>
      )}
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-zinc-400" />
      <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold text-white ${KIND_COLOR[kind]}`}
        >
          {KIND_LABEL[kind]}
        </span>
        <span className="truncate text-xs font-medium text-zinc-800">
          {title}
        </span>
        {stale && (
          <span
            className="ml-auto shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
            data-testid="stale-badge"
          >
            이전 조건 기준
          </span>
        )}
        {!stale && badge && (
          <span
            className="ml-auto shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700"
            data-testid="warn-badge"
          >
            {badge}
          </span>
        )}
      </div>
      <div className="px-3 py-2 text-xs text-zinc-600">{children}</div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-zinc-400" />
    </div>
  );
}
