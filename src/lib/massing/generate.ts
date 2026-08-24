// 규칙 기반 매스 대안 생성 (M4). A-7: 형태 생성 AI가 아니라 규칙 기반 대안.
// 대지 경계를 중심 축척해 바닥면적을 만들고, 법정 최대 연면적을 층수로 나눈다.

import { area as turfArea, bbox, transformScale } from "@turf/turf";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import type { MassScenario, SiteGeometry } from "@/types/project";
import { checkSunlight } from "@/lib/regulation/sunlight";

export interface MassParams {
  boundary: SiteGeometry;
  /** 계산 기준 대지면적 (공부) */
  siteArea: number;
  bcr: number;
  far: number;
  floorHeight: number;
  useZone: string;
}

const PRESETS: { name: string; ratio: number; description: string }[] = [
  { name: "저층 판상형", ratio: 1.0, description: "건폐율을 최대로 쓰고 층수를 최소화" },
  { name: "중층 균형형", ratio: 0.7, description: "바닥 70%, 외부공간과 층수의 균형" },
  { name: "고층 탑상형", ratio: 0.45, description: "바닥 45%, 층수를 늘려 외부공간 확보" },
];

function toFeature(g: SiteGeometry): Feature<Polygon | MultiPolygon> {
  return { type: "Feature", properties: {}, geometry: g } as Feature<Polygon | MultiPolygon>;
}

/** 주어진 비율로 한 대안을 만든다 */
export function buildScenario(
  p: MassParams,
  ratio: number,
  name: string,
  description?: string,
): MassScenario {
  const maxBuildingArea = (p.siteArea * p.bcr) / 100;
  const maxGross = (p.siteArea * p.far) / 100;
  const footprintArea = maxBuildingArea * ratio;
  const floors = Math.max(1, Math.ceil(maxGross / footprintArea));
  const height = floors * p.floorHeight;

  const boundaryFeature = toFeature(p.boundary);
  const boundaryArea = turfArea(boundaryFeature);
  const factor = Math.sqrt(footprintArea / boundaryArea);
  const footprintFeature = transformScale(boundaryFeature, factor, { origin: "centroid" });
  const footprint = footprintFeature.geometry as SiteGeometry;

  // 정북일조: 중심 배치 가정 → 북측 여유 = (대지 남북 깊이 - 바닥 남북 깊이) / 2
  const sun = checkSunlight(p.useZone, height, p.boundary);
  const [, fMinLat, , fMaxLat] = bbox(footprintFeature);
  const footprintDepth = (fMaxLat - fMinLat) * 111_320;
  const northSlack = sun.siteDepthNS !== null ? (sun.siteDepthNS - footprintDepth) / 2 : null;
  const sunlightOk = !sun.applies || (northSlack !== null && northSlack >= sun.requiredSetback);

  const notes: string[] = [];
  if (sun.applies) {
    notes.push(
      `정북일조 필요 이격 ${sun.requiredSetback.toFixed(1)}m vs 중심 배치 시 북측 여유 ${(northSlack ?? 0).toFixed(1)}m → ${sunlightOk ? "통과(개략)" : "부족 — 남측 이동 또는 층수 조정 필요"}`,
    );
  }
  notes.push(`최상층은 ${(maxGross - footprintArea * (floors - 1)).toFixed(0)}㎡로 부분층 (연면적을 법정 최대에 맞춤)`);

  return {
    id: crypto.randomUUID(),
    name,
    description,
    floors,
    floorHeight: p.floorHeight,
    grossFloorArea: maxGross,
    bcr: (footprintArea / p.siteArea) * 100,
    far: p.far,
    createdAt: new Date().toISOString(),
    footprint,
    footprintArea,
    footprintRatio: ratio,
    height,
    sunlightOk,
    sunlightSetback: sun.applies ? sun.requiredSetback : 0,
    notes,
  };
}

/**
 * 직접 그린 외곽선으로 대안을 만든다 (WP 방식).
 * 축척 근사가 아니라 사용자가 지정한 실제 지오메트리를 그대로 쓴다.
 */
export function buildCustomScenario(
  p: MassParams,
  footprint: SiteGeometry,
  name = "직접 그린 매스",
): MassScenario {
  const footprintFeature = toFeature(footprint);
  const footprintArea = turfArea(footprintFeature);
  const maxGross = (p.siteArea * p.far) / 100;
  const maxBuildingArea = (p.siteArea * p.bcr) / 100;
  const floors = Math.max(1, Math.ceil(maxGross / Math.max(1, footprintArea)));
  const height = floors * p.floorHeight;

  const sun = checkSunlight(p.useZone, height, p.boundary);
  const [, fMinLat, , fMaxLat] = bbox(footprintFeature);
  const footprintDepth = (fMaxLat - fMinLat) * 111_320;
  const northSlack = sun.siteDepthNS !== null ? (sun.siteDepthNS - footprintDepth) / 2 : null;
  const sunlightOk = !sun.applies || (northSlack !== null && northSlack >= sun.requiredSetback);

  const notes: string[] = ["사용자가 직접 그린 외곽선 (지오메트리 그대로 사용)"];
  if (footprintArea > maxBuildingArea + 0.5) {
    notes.push(
      `⚠ 건폐율 초과 — 최대 건축면적 ${maxBuildingArea.toFixed(0)}㎡ 대비 ${(footprintArea - maxBuildingArea).toFixed(0)}㎡ 초과`,
    );
  }
  if (sun.applies) {
    notes.push(
      `정북일조 필요 이격 ${sun.requiredSetback.toFixed(1)}m vs 북측 여유 ${(northSlack ?? 0).toFixed(1)}m → ${sunlightOk ? "통과(개략)" : "부족"}`,
    );
  }

  return {
    id: crypto.randomUUID(),
    name,
    description: "2D 지도에서 직접 그린 건물 외곽선",
    floors,
    floorHeight: p.floorHeight,
    grossFloorArea: maxGross,
    bcr: (footprintArea / p.siteArea) * 100,
    far: p.far,
    createdAt: new Date().toISOString(),
    footprint,
    footprintArea,
    footprintRatio: footprintArea / Math.max(1, maxBuildingArea),
    height,
    sunlightOk,
    sunlightSetback: sun.applies ? sun.requiredSetback : 0,
    notes,
  };
}

export function generateMassAlternatives(p: MassParams): MassScenario[] {
  return PRESETS.map((preset) => buildScenario(p, preset.ratio, preset.name, preset.description));
}
