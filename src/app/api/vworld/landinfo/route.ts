// 필지(PNU) 단위 토지 정보 조회 — 브이월드 NED(부동산정보) API 경유.
//  - 토지특성(getLandCharacteristics): 지적공부 면적(lndpclAr), 용도지역, 지목
//  - 토지이용계획(getLandUseAttr): 용도지역·지구·구역 목록 (포함/저촉)
// 연도별 이력이 오므로 토지특성은 최신 기준연도 레코드를 쓴다.

const NED_BASE = "https://api.vworld.kr/ned/data";

export interface LandInfo {
  pnu: string;
  /** 지적공부 면적(㎡). 조회 실패 시 null */
  officialArea: number | null;
  /** 용도지역 (토지특성 최신 연도 기준) */
  useZone: string | null;
  jimok: string | null;
  /** 기준연도 */
  stdrYear: string | null;
  /** 용도지역·지구·구역 목록. 저촉·접합은 명칭 뒤에 표기 */
  landUses: string[];
}

interface LandCharRecord {
  stdrYear?: string;
  lndpclAr?: string;
  prposArea1Nm?: string;
  lndcgrCodeNm?: string;
}

interface LandUseRecord {
  prposAreaDstrcCodeNm?: string;
  cnflcAtNm?: string;
}

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

export async function GET(request: Request) {
  const pnu = new URL(request.url).searchParams.get("pnu")?.trim();
  if (!pnu || !/^\d{19}$/.test(pnu)) {
    return Response.json(
      { error: "pnu parameter (19 digits) is required" },
      { status: 400 },
    );
  }

  try {
    const [charJson, useJson] = await Promise.all([
      nedFetch("getLandCharacteristics", { pnu, numOfRows: "100" }),
      nedFetch("getLandUseAttr", { pnu, numOfRows: "100" }),
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

    const info: LandInfo = {
      pnu,
      officialArea: latest?.lndpclAr ? Number(latest.lndpclAr) : null,
      useZone: latest?.prposArea1Nm ?? null,
      jimok: latest?.lndcgrCodeNm ?? null,
      stdrYear: latest?.stdrYear ?? null,
      landUses: [...new Set(landUses)],
    };
    return Response.json({ landInfo: info });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "land info lookup failed" },
      { status: 502 },
    );
  }
}
