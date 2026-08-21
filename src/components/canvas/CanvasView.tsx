"use client";

import { useEffect, useMemo } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  BuildingNode,
  CaptureNode,
  RegulationNode,
  RenderNode,
  SiteNode,
  ViewportNode,
} from "./nodes";
import { refreshRegulation } from "@/lib/regulation/landinfo";
import { useProjectStore, type CaptureRecord } from "@/store/project";
import { useUiStore, type NodeKind } from "@/store/ui";
import ExpansionOverlay from "./ExpansionOverlay";

const nodeTypes = {
  site: SiteNode,
  regulation: RegulationNode,
  building: BuildingNode,
  viewport: ViewportNode,
  capture: CaptureNode,
  render: RenderNode,
};

// 의존성 흐름: site → building → viewport → capture → render (A-3의 UI 표현)
function buildGraph(captures: CaptureRecord[]): {
  nodes: Node[];
  edges: Edge[];
} {
  const nodes: Node[] = [
    { id: "site", type: "site", position: { x: 40, y: 120 }, data: {} },
    { id: "regulation", type: "regulation", position: { x: 360, y: 280 }, data: {} },
    { id: "building", type: "building", position: { x: 360, y: 120 }, data: {} },
    { id: "viewport", type: "viewport", position: { x: 680, y: 100 }, data: {} },
  ];
  const edges: Edge[] = [
    { id: "e-site-building", source: "site", target: "building", animated: false },
    { id: "e-site-regulation", source: "site", target: "regulation" },
    { id: "e-building-viewport", source: "building", target: "viewport" },
  ];

  // 오래된 캡처가 위, 새 캡처가 아래 (생성 순서대로 쌓임)
  let y = 60;
  for (const capture of [...captures].reverse()) {
    const captureNodeId = `capture-${capture.id}`;
    nodes.push({
      id: captureNodeId,
      type: "capture",
      position: { x: 1020, y },
      data: { captureId: capture.id },
    });
    edges.push({
      id: `e-viewport-${capture.id}`,
      source: "viewport",
      target: captureNodeId,
    });

    let renderY = y;
    for (const render of [...capture.renders].reverse()) {
      nodes.push({
        id: `render-${render.id}`,
        type: "render",
        position: { x: 1340, y: renderY },
        data: { captureId: capture.id, renderId: render.id },
      });
      edges.push({
        id: `e-${capture.id}-${render.id}`,
        source: captureNodeId,
        target: `render-${render.id}`,
      });
      renderY += 230;
    }
    y = Math.max(y + 260, renderY + 30);
  }

  return { nodes, edges };
}

export default function CanvasView() {
  const captures = useProjectStore((s) => s.captures);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const graph = useMemo(() => buildGraph(captures), [captures]);

  // 새 노드는 추가하고, 이미 있는 노드는 사용자가 끌어놓은 위치를 유지한다
  useEffect(() => {
    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return graph.nodes.map((n) => {
        const existing = prevById.get(n.id);
        return existing ? { ...n, position: existing.position } : n;
      });
    });
    setEdges(graph.edges);
  }, [graph, setNodes, setEdges]);

  // 상류 변경 추적 → 하류 노드 stale 판정 근거.
  // site는 boundary 참조로 비교한다 — mergeParcelLandInfo(토지정보 병합)는
  // boundary를 유지하므로 필지 구성이 실제로 바뀔 때만 감지된다.
  useEffect(
    () =>
      useProjectStore.subscribe((state, prev) => {
        const siteChanged = state.site.boundary !== prev.site.boundary;
        const modelChanged =
          state.massing.modelRef !== prev.massing.modelRef ||
          state.massing.placement !== prev.massing.placement;
        if (siteChanged) useUiStore.getState().markSiteChange();
        if (siteChanged || modelChanged)
          useUiStore.getState().markUpstreamChange();
      }),
    [],
  );

  // 대지(필지 구성) 변경 시 토지이용계획·토지특성 자동 조회 (B-4 지시 1·2)
  const pnuKey = useProjectStore((s) =>
    s.site.parcels
      .map((p) => p.pnu)
      .sort()
      .join(","),
  );
  useEffect(() => {
    if (!pnuKey) return;
    const t = setTimeout(() => {
      void refreshRegulation(useProjectStore.getState().site.parcels);
    }, 500);
    return () => clearTimeout(t);
  }, [pnuKey]);

  const setExpandedNode = useUiStore((s) => s.setExpandedNode);

  return (
    <div className="h-full w-full" data-testid="node-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onNodeDoubleClick={(_, node) =>
          setExpandedNode(node.id, node.type as NodeKind)
        }
        fitView
        minZoom={0.3}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        deleteKeyCode={null}
      >
        <Background gap={20} color="#d4d4d8" />
        <Controls showInteractive={false} />
      </ReactFlow>
      <ExpansionOverlay />
    </div>
  );
}
