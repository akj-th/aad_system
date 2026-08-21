// 평면 초안 다이어그램 (M6). A-7: 정밀 평면 자동생성이 아니라 초안 다이어그램 수준.
// 매스 바닥 폴리곤(지오메트리)에서 직접 파생하므로 면적표와 정합한다 (C-3 정합 보장).

import planning from "@/data/regulations/planning.json";
import { centroid } from "@turf/turf";
import type { FloorArea, SiteGeometry, Position } from "@/types/project";

interface PlanningJson {
  core: { ratio: number; minArea: number; aspect: number; basis: string };
  gridModule: number;
  gridBasis: string;
}
const DATA = planning as PlanningJson;

export const PLAN_BASIS = { core: DATA.core.basis, grid: DATA.gridBasis };

/** 경위도 폴리곤 → 중심 기준 로컬 미터 좌표 (등장방형 근사) */
export function toLocalMeters(geometry: SiteGeometry): { rings: [number, number][][]; width: number; depth: number } {
  const c = centroid({ type: "Feature", properties: {}, geometry }).geometry.coordinates;
  const kx = 111_320 * Math.cos((c[1] * Math.PI) / 180);
  const ky = 111_320;
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const rings: [number, number][][] = polys.map((rings) =>
    rings[0].map(([x, y]: Position) => [(x - c[0]) * kx, (y - c[1]) * ky] as [number, number]),
  );
  const xs = rings.flat().map((p) => p[0]);
  const ys = rings.flat().map((p) => p[1]);
  return {
    rings,
    width: Math.max(...xs) - Math.min(...xs),
    depth: Math.max(...ys) - Math.min(...ys),
  };
}

export interface PlanDiagram {
  svg: string;
  floorArea: number;
  coreArea: number;
  netArea: number;
  width: number;
  depth: number;
}

const USE_COLORS: Record<string, string> = {
  neighborhood_lodging: "#fde68a",
  amusement: "#fecaca",
  assembly_business: "#bfdbfe",
  other: "#e2e8f0",
  training_factory: "#e7e5e4",
  warehouse: "#e5e5e5",
  dormitory: "#ddd6fe",
  apartment: "#a7f3d0",
  parking: "#f4f4f5",
};

export function buildPlanDiagram(
  footprint: SiteGeometry,
  floor: FloorArea,
  label: string,
  sizePx = 520,
): PlanDiagram {
  const { rings, width, depth } = toLocalMeters(footprint);
  const coreArea = Math.max(DATA.core.minArea, floor.area * DATA.core.ratio);
  const coreW = Math.sqrt(coreArea / DATA.core.aspect);
  const coreD = coreW * DATA.core.aspect;
  const netArea = floor.area - coreArea;

  const margin = 48;
  const span = Math.max(width, depth);
  const scale = (sizePx - margin * 2) / span;
  const toSvg = ([x, y]: [number, number]) => [sizePx / 2 + x * scale, sizePx / 2 - y * scale];

  const paths = rings
    .map((ring) => "M" + ring.map((p) => toSvg(p).map((v) => v.toFixed(1)).join(",")).join("L") + "Z")
    .join(" ");

  // 구조 그리드 (모듈 격자) — 바닥 범위 안에만
  const g = DATA.gridModule;
  const gridLines: string[] = [];
  for (let x = -Math.ceil(width / 2 / g) * g; x <= width / 2; x += g) {
    const [sx] = toSvg([x, 0]);
    gridLines.push(`<line x1="${sx.toFixed(1)}" y1="${margin}" x2="${sx.toFixed(1)}" y2="${sizePx - margin}" />`);
  }
  for (let y = -Math.ceil(depth / 2 / g) * g; y <= depth / 2; y += g) {
    const [, sy] = toSvg([0, y]);
    gridLines.push(`<line x1="${margin}" y1="${sy.toFixed(1)}" x2="${sizePx - margin}" y2="${sy.toFixed(1)}" />`);
  }

  const [cx, cy] = toSvg([-coreW / 2, coreD / 2]);
  const fill = USE_COLORS[floor.use] ?? "#e2e8f0";
  const fmt = (n: number) => n.toLocaleString("ko-KR", { maximumFractionDigits: 1 });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sizePx} ${sizePx}" width="${sizePx}" height="${sizePx}" font-family="sans-serif">
<rect width="100%" height="100%" fill="#fff"/>
<defs><clipPath id="fp"><path d="${paths}"/></clipPath></defs>
<g clip-path="url(#fp)" stroke="#cbd5e1" stroke-width="0.6" stroke-dasharray="3 3">${gridLines.join("")}</g>
<path d="${paths}" fill="${fill}" fill-opacity="0.55" stroke="#0f172a" stroke-width="2"/>
<rect x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" width="${(coreW * scale).toFixed(1)}" height="${(coreD * scale).toFixed(1)}" fill="#94a3b8" stroke="#0f172a" stroke-width="1.5"/>
<text x="${(cx + (coreW * scale) / 2).toFixed(1)}" y="${(cy + (coreD * scale) / 2 + 4).toFixed(1)}" font-size="11" text-anchor="middle" fill="#0f172a">CORE ${fmt(coreArea)}㎡</text>
<text x="${sizePx / 2}" y="${margin - 18}" font-size="13" text-anchor="middle" fill="#0f172a" font-weight="600">${label}</text>
<text x="${sizePx / 2}" y="${sizePx - margin + 26}" font-size="11" text-anchor="middle" fill="#475569">W ${fmt(width)}m × D ${fmt(depth)}m · 바닥 ${fmt(floor.area)}㎡ · 전용 약 ${fmt(netArea)}㎡</text>
<text x="${sizePx / 2}" y="${sizePx - margin + 40}" font-size="9" text-anchor="middle" fill="#94a3b8">그리드 ${g}m · 초안 다이어그램 (코어 ${Math.round(DATA.core.ratio * 100)}% 가정)</text>
<g transform="translate(${sizePx - margin}, ${margin})"><polygon points="0,-14 5,6 0,2 -5,6" fill="#0f172a"/><text y="20" font-size="10" text-anchor="middle" fill="#0f172a">N</text></g>
</svg>`;

  return { svg, floorArea: floor.area, coreArea, netArea, width, depth };
}
