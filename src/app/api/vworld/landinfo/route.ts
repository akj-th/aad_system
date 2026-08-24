// 필지(PNU) 단위 토지 정보 조회 — 브이월드 NED(부동산정보) API 경유.
//  - 토지특성(getLandCharacteristics): 공부면적·용도지역·지목·도로접면·지형·형상·공시지가
//  - 토지이용계획(getLandUseAttr): 용도지역·지구·구역 목록 (포함/저촉/접함)
//  - 건축물정보(getBuildingUse): 기존 건축물대장 개요 (용도·구조·층수·높이·건폐율)
// 연도별 이력이 오므로 토지특성은 최신 기준연도 레코드를 쓴다.

const NED_BASE = "https://api.vworld.kr/ned/data";

export interface ExistingBuilding {
  /** 건물명 (없으면 빈 문자열) */
  name: string;
  /** 주용도 (예: 종교시설) */
  mainUse: string;
  detailUse: string;
  structure: string;
  /** 연면적(㎡) */
  totalArea: number | null;
  /** 건축면적(㎡) */
  buildingArea: number | null;
  groundFloors: number | null;
  basementFloors: number | null;
  /** 높이(m) */
  height: number | null;
  /** 건폐율(%) — 대장 기재값 */
  bcr: number | null;
  /** 용적률(%) — 대장 기재값 */
  far: number | null;
  /** 사용승인일 (YYYY-MM-DD) */
  approvedAt: string | null;
  registerType: string;
}

export interface LandInfo {
  pnu: string;
  /** 지적공부 면적(㎡). 조회 실패 시 null */
  officialArea: number | null;
  /** 용도지역 (토지특성 최신 연도 기준) */
  useZone: string | null;
  jimok: string | null;
  /** 기준연도 */
  stdrYear: string | null;
  /** 도로접면 (예: 광대소각) — 접도 조건 판단 근거 */
  roadSide: string | null;
  /** 지형고저 (예: 평지) */
  terrain: string | null;
  /** 토지형상 (예: 사다리형) */
  shape: string | null;
  /** 이용상황 (예: 상업기타) */
  useSituation: string | null;
  /** 개별공시지가(원/㎡) */
  jiga: number | null;
  /** 용도지역·지구·구역 목록. 저촉·접함은 명칭 뒤에 표기 */
  landUses: string[];
  /** 지구단위계획구역 등 별도 지침 확인이 필요한 항목 */
  planningDistricts: string[];
  /** 기존 건축물 (건축물대장) */
  buildings: ExistingBuilding[];
}

interface LandCharRecord {
  stdrYear?: string;
  lndpclAr?: string;
  prposArea1Nm?: string;
  lndcgrCodeNm?: string;
  roadSideCodeNm?: string;
  tpgrphHgCodeNm?: string;
  tpgrphFrmCodeNm?: string;
  ladUseSittnNm?: string;
  pblntfPclnd?: string;
}

interface LandUseRecord {
  prposAreaDstrcCodeNm?: string;
  cnflcAtNm?: string;
}

interface BuildingRecord {
  buldNm?: string;
  mainPrposCodeNm?: string;
  detailPrposCodeNm?: string;
  strctCodeNm?: string;
  buldTotar?: string;
  buldBildngAr?: string;
  groundFloorCo?: string;
  undgrndFloorCo?: string;
  buldHg?: string;
  btlRt?: string;
  measrmtRt?: string;
  useConfmDe?: string;
  buldKndCodeNm?: string;
  buldMainAtachSeCodeNm?: string;
}

/** 지침·고시 원문 확인이 필요한 계획 항목 (해석하지 않고 링크로 연결한다) */
const PLANNING_KEYWORDS = ["지구단위계획", "정비구역", "재정비", "택지개발", "도시개발", "경관관리"];

async function nedFetch(
  path: string,
  params: Record<string, string>,
): Promise<unknown> {
  const key = process.env.VWORLD_API_KEY;
  const domain = process.env.VWORLD_DOMAIN;
  if (!key || !domain) {
    throw new Error("VWORLD_API_KEY / VWORLD_DOMAIN is not set");
  }
  const query = new URLSearchParams({ key, format: "json", ...params });
  const res = await fetch(`${NED_BASE}/${path}?${query}`, {
    headers: { Referer: `http://${domain}:3000/` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`NED ${path} responded ${res.status}`);
  return res.json();
}

const num = (v: string | undefined): number | null =>
  v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null;

export async function GET(request: Request) {
  const pnu = new URL(request.url).searchParams.get("pnu")?.trim();
  if (!pnu || !/^\d{19}$/.test(pnu)) {
    return Response.json(
      { error: "pnu parameter (19 digits) is required" },
      { status: 400 },
    );
  }

  try {
    // 건축물정보는 없는 필지도 많아 실패해도 나머지는 살린다
    const [charJson, useJson, bldJson] = await Promise.all([
      nedFetch("getLandCharacteristics", { pnu, numOfRows: "100" }),
      nedFetch("getLandUseAttr", { pnu, numOfRows: "100" }),
      nedFetch("getBuildingUse", { pnu, numOfRows: "20" }).catch(() => null),
    ]);

    const charRecords =
      ((charJson as { landCharacteristicss?: { field?: LandCharRecord[] } })
        .landCharacteristicss?.field ?? []);
    // 최신 기준연도 레코드 선택
    const latest = [...charRecords].sort(
      (a, b) => Number(b.stdrYear ?? 0) - Number(a.stdrYear ?? 0),
    )[0];

    const useRecords =
      ((useJson as { landUses?: { field?: LandUseRecord[] } }).landUses
        ?.field ?? []);
    const landUses = useRecords
      .filter((r) => r.prposAreaDstrcCodeNm)
      .map((r) =>
        r.cnflcAtNm && r.cnflcAtNm !== "포함"
          ? `${r.prposAreaDstrcCodeNm}(${r.cnflcAtNm})`
          : r.prposAreaDstrcCodeNm!,
      );

    const buildings: ExistingBuilding[] = (
      (bldJson as { buildingUses?: { field?: BuildingRecord[] } } | null)
        ?.buildingUses?.field ?? []
    ).map((b) => ({
      name: b.buldNm ?? "",
      mainUse: b.mainPrposCodeNm ?? "",
      detailUse: b.detailPrposCodeNm ?? "",
      structure: b.strctCodeNm ?? "",
      totalArea: num(b.buldTotar),
      buildingArea: num(b.buldBildngAr),
      groundFloors: num(b.groundFloorCo),
      basementFloors: num(b.undgrndFloorCo),
      height: num(b.buldHg),
      bcr: num(b.btlRt),
      far: num(b.measrmtRt),
      approvedAt: b.useConfmDe
        ? b.useConfmDe.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3")
        : null,
      registerType: b.buldKndCodeNm ?? "",
    }));

    const uniqueUses = [...new Set(landUses)];
    const info: LandInfo = {
      pnu,
      officialArea: num(latest?.lndpclAr),
      useZone: latest?.prposArea1Nm ?? null,
      jimok: latest?.lndcgrCodeNm ?? null,
      stdrYear: latest?.stdrYear ?? null,
      roadSide: latest?.roadSideCodeNm ?? null,
      terrain: latest?.tpgrphHgCodeNm ?? null,
      shape: latest?.tpgrphFrmCodeNm ?? null,
      useSituation: latest?.ladUseSittnNm ?? null,
      jiga: num(latest?.pblntfPclnd),
      landUses: uniqueUses,
      planningDistricts: uniqueUses.filter((u) =>
        PLANNING_KEYWORDS.some((k) => u.includes(k)),
      ),
      buildings,
    };
    return Response.json({ landInfo: info });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "land info lookup failed" },
      { status: 502 },
    );
  }
}
