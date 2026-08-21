// 법규 계산부 (M2). A-5 원칙: 계산은 전부 결정론적 코드 — AI 호출 없음.
// 수치·규칙은 src/data/regulations/*.json에서만 온다 (코드에 하드코딩 금지).

import national from "@/data/regulations/national.json";
import seoul from "@/data/regulations/seoul.json";

interface ZoneLimit {
  bcr: number;
  far: number;
}

interface RegulationTable {
  id: string;
  name: string;
  shortName: string;
  jurisdictionPrefix?: string;
  articles: { bcr: string; far: string };
  note?: string;
  zones: Record<string, ZoneLimit>;
}

const NATIONAL = national as RegulationTable;
const LOCAL_TABLES: RegulationTable[] = [seoul as RegulationTable];

/** "제3종일반주거지역(7층이하)" 같은 변형을 표준 명칭으로 정규화 */
export function normalizeZoneName(raw: string): string {
  return raw.replace(/\(.*?\)/g, "").replace(/\s+/g, "").trim();
}

export interface LimitWithBasis {
  value: number;
  /** 근거 표기, 예: "국계법 시행령 제84조" */
  basis: string;
}

export interface ZoneLimits {
  zone: string;
  legal: { bcr: LimitWithBasis; far: LimitWithBasis } | null;
  /** 조례값. 관할 조례 미수록이면 null */
  local: { bcr: LimitWithBasis; far: LimitWithBasis; name: string } | null;
  /** 적용값 = 조례 있으면 조례, 없으면 법정 상한 */
  applied: { bcr: LimitWithBasis; far: LimitWithBasis } | null;
  localNote?: string;
}

export function lookupZoneLimits(useZoneRaw: string, addr: string): ZoneLimits {
  const zone = normalizeZoneName(useZoneRaw);

  const nationalLimit = NATIONAL.zones[zone];
  const legal = nationalLimit
    ? {
        bcr: { value: nationalLimit.bcr, basis: `${NATIONAL.shortName} ${NATIONAL.articles.bcr}` },
        far: { value: nationalLimit.far, basis: `${NATIONAL.shortName} ${NATIONAL.articles.far}` },
      }
    : null;

  const table = LOCAL_TABLES.find(
    (t) => t.jurisdictionPrefix && addr.startsWith(t.jurisdictionPrefix),
  );
  const localLimit = table?.zones[zone];
  const local =
    table && localLimit
      ? {
          bcr: { value: localLimit.bcr, basis: `${table.shortName} ${table.articles.bcr}` },
          far: { value: localLimit.far, basis: `${table.shortName} ${table.articles.far}` },
          name: table.name,
        }
      : null;

  const applied = local
    ? { bcr: local.bcr, far: local.far }
    : legal
      ? {
          bcr: { ...legal.bcr, basis: `${legal.bcr.basis} (조례 미수록 — 상한값, 실제 조례 확인 필요)` },
          far: { ...legal.far, basis: `${legal.far.basis} (조례 미수록 — 상한값, 실제 조례 확인 필요)` },
        }
      : null;

  return { zone, legal, local, applied, localNote: table?.note };
}

export interface AreaCalcResult {
  /** 최대 건축면적 = 대지면적 × 건폐율 */
  maxBuildingArea: number;
  /** 최대 연면적 = 대지면적 × 용적률 */
  maxGrossArea: number;
  /** 개략 층수 = ceil(용적률/건폐율) — 기준층이 최대 건축면적일 때 필요한 층수 */
  estFloors: number;
  /** 개략 높이 = 개략 층수 × 층고 */
  estHeight: number;
}

export function calcAreas(
  siteArea: number,
  bcrPercent: number,
  farPercent: number,
  floorHeight: number,
): AreaCalcResult {
  const maxBuildingArea = (siteArea * bcrPercent) / 100;
  const maxGrossArea = (siteArea * farPercent) / 100;
  const estFloors =
    bcrPercent > 0 ? Math.ceil(farPercent / bcrPercent) : 0;
  return {
    maxBuildingArea,
    maxGrossArea,
    estFloors,
    estHeight: estFloors * floorHeight,
  };
}
