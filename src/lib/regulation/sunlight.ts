// 정북일조 높이제한 개략 검토 (결정론). 규칙은 sunlight.json에서만 온다.
// 개략 수준: 대지 경계의 남북 깊이와 건물 높이만으로 필요 이격거리·가용 깊이를 산출한다.
// 정밀 검토(인접대지 현황, 정북 방향 판정, 조례 이격 완화)는 범위 밖.

import sunlight from "@/data/regulations/sunlight.json";
import { bbox } from "@turf/turf";
import type { SiteGeometry } from "@/types/project";
import { normalizeZoneName } from "./calc";

interface SunlightData {
  shortName: string;
  article: string;
  parentLaw: string;
  note: string;
  appliesToZones: string[];
  threshold: number;
  rules: { maxHeight: number | null; setback?: number; setbackRatio?: number; basis: string }[];
  abolished: { name: string; basis: string }[];
}

const DATA = sunlight as SunlightData;

export interface SunlightResult {
  applies: boolean;
  zone: string;
  height: number;
  /** 정북 인접대지경계선에서 필요한 최소 이격거리(m) */
  requiredSetback: number;
  basis: string;
  /** 대지 남북 깊이(m, bbox 기준) */
  siteDepthNS: number | null;
  /** 이격 후 남는 남북 가용 깊이(m) */
  usableDepthNS: number | null;
  /** 이격 없이 가능한 최대 높이 참고값: 남북 깊이 전체를 이격으로 쓸 때 */
  note: string;
  abolished: { name: string; basis: string }[];
}

export function requiredNorthSetback(height: number): { setback: number; basis: string } {
  if (height <= DATA.threshold) {
    const r = DATA.rules[0];
    return { setback: r.setback ?? 0, basis: `${DATA.shortName} ${DATA.article} — ${r.basis}` };
  }
  const r = DATA.rules[1];
  return {
    setback: height * (r.setbackRatio ?? 0.5),
    basis: `${DATA.shortName} ${DATA.article} — ${r.basis}`,
  };
}

/** 남북 깊이(m): 경계 bbox의 위도 차 × 111,320m */
export function siteDepthNorthSouth(boundary: SiteGeometry | null): number | null {
  if (!boundary) return null;
  const [, minLat, , maxLat] = bbox({ type: "Feature", properties: {}, geometry: boundary });
  return (maxLat - minLat) * 111_320;
}

export function checkSunlight(
  useZone: string,
  height: number,
  boundary: SiteGeometry | null,
): SunlightResult {
  const zone = normalizeZoneName(useZone);
  const applies = DATA.appliesToZones.includes(zone);
  const { setback, basis } = requiredNorthSetback(height);
  const depth = siteDepthNorthSouth(boundary);
  return {
    applies,
    zone,
    height,
    requiredSetback: applies ? setback : 0,
    basis: applies ? basis : `${DATA.parentLaw}: 전용·일반주거지역 외에는 정북일조 미적용`,
    siteDepthNS: depth,
    usableDepthNS: applies && depth !== null ? Math.max(0, depth - setback) : depth,
    note: DATA.note,
    abolished: DATA.abolished,
  };
}
