// 대지 선택 시 토지특성·토지이용계획을 자동 조회해 ProjectState.regulation에
// 반영하는 클라이언트 헬퍼. 판단·계산은 lookupZoneLimits/calcAreas(결정론)가 한다.

import type { DocRef, ExistingBuilding, Parcel, ProvenanceEntry } from "@/types/project";
import type { LandInfo } from "@/app/api/vworld/landinfo/route";
import { useProjectStore } from "@/store/project";
import { lookupZoneLimits } from "./calc";

/** 토지이음 필지 상세 (용도지역·지구, 지구단위계획 지침 원문 확인) */
export function eumLandUrl(pnu: string): string {
  return `https://www.eum.go.kr/web/ar/lu/luLandDet.jsp?pnu=${pnu}`;
}

/** 국가법령정보센터 자치법규 검색 (해당 지자체 도시계획 조례) */
export function localOrdinanceUrl(addr: string): string {
  const sido = addr.split(" ")[0] ?? "";
  return `https://www.law.go.kr/ordinSc.do?menuId=3&query=${encodeURIComponent(`${sido} 도시계획 조례`)}`;
}

/** 지자체 고시·공고 검색 (지구단위계획 결정 고시 원문) */
export function noticeSearchUrl(addr: string, district: string): string {
  const sido = addr.split(" ")[0] ?? "";
  return `https://www.google.com/search?q=${encodeURIComponent(`${sido} ${district} 지구단위계획 결정 고시`)}`;
}

async function fetchLandInfo(pnu: string): Promise<LandInfo | null> {
  try {
    const res = await fetch(`/api/vworld/landinfo?pnu=${pnu}`);
    if (!res.ok) return null;
    const json = (await res.json()) as { landInfo?: LandInfo };
    return json.landInfo ?? null;
  } catch {
    return null;
  }
}

/**
 * 선택된 전체 필지의 토지 정보를 조회해 regulation 슬라이스를 갱신한다.
 * 대표 용도지역 = 공부면적(없으면 도형면적) 최대 필지의 용도지역.
 */
export async function refreshRegulation(parcels: Parcel[]): Promise<void> {
  const { setRegulation, mergeParcelLandInfo } = useProjectStore.getState();
  if (parcels.length === 0) return;

  const infos = await Promise.all(parcels.map((p) => fetchLandInfo(p.pnu)));
  const now = new Date().toISOString();

  const byPnu: Record<string, Partial<Parcel>> = {};
  const existingBuildings: ExistingBuilding[] = [];
  infos.forEach((info) => {
    if (!info) return;
    byPnu[info.pnu] = {
      officialArea: info.officialArea ?? undefined,
      useZone: info.useZone ?? undefined,
      roadSide: info.roadSide ?? undefined,
      terrain: info.terrain ?? undefined,
      shape: info.shape ?? undefined,
      useSituation: info.useSituation ?? undefined,
      // 연속지적도 jiga가 없으면 토지특성 공시지가로 보완
      ...(info.jiga != null ? { jiga: info.jiga } : {}),
    };
    for (const b of info.buildings) {
      existingBuildings.push({ ...b, pnu: info.pnu });
    }
  });

  // 대표 필지: 공부면적(폴백 도형면적) 최대
  const weighted = parcels.map((p, i) => ({
    parcel: p,
    info: infos[i],
    weight: infos[i]?.officialArea ?? p.area,
  }));
  const rep = [...weighted].sort((a, b) => b.weight - a.weight)[0];
  const useZone = rep.info?.useZone ?? "";
  const zones = new Set(
    weighted.map((w) => w.info?.useZone).filter((z): z is string => !!z),
  );

  const useDistrict = [
    ...new Set(infos.flatMap((info) => info?.landUses ?? [])),
  ].filter((n) => n !== useZone);

  const addr = rep.parcel.addr ?? "";
  const limits = useZone ? lookupZoneLimits(useZone, addr) : null;

  const provenance: ProvenanceEntry[] = [
    {
      field: "regulation.useZone",
      value: useZone,
      source: "legal_document",
      basis: `토지특성 API (기준연도 ${rep.info?.stdrYear ?? "?"})`,
      timestamp: now,
    },
  ];
  if (limits?.applied) {
    provenance.push(
      {
        field: "regulation.bcr.applied",
        value: limits.applied.bcr.value,
        source: "legal_document",
        basis: limits.applied.bcr.basis,
        timestamp: now,
      },
      {
        field: "regulation.far.applied",
        value: limits.applied.far.value,
        source: "legal_document",
        basis: limits.applied.far.basis,
        timestamp: now,
      },
    );
  }
  infos.forEach((info) => {
    if (info?.officialArea != null) {
      provenance.push({
        field: `site.parcels[${info.pnu}].officialArea`,
        value: info.officialArea,
        source: "legal_document",
        basis: "토지대장 (토지특성 API)",
        timestamp: now,
      });
    }
  });

  // 지구단위계획 등 지침 원문 확인이 필요한 구역 — 해석하지 않고 링크로 연결한다
  const planningDistricts = [
    ...new Set(infos.flatMap((info) => info?.planningDistricts ?? [])),
  ];
  const documentRefs: DocRef[] = planningDistricts.length
    ? [
        { title: "토지이음 — 필지 토지이용계획 확인", url: eumLandUrl(rep.parcel.pnu) },
        ...planningDistricts.map((d) => ({
          title: `${d} 결정 고시 검색`,
          url: noticeSearchUrl(addr, d),
        })),
      ]
    : [];

  mergeParcelLandInfo(byPnu, existingBuildings);
  setRegulation(
    {
      useZone,
      useDistrict,
      dpUnitPlan: {
        applies: planningDistricts.length > 0,
        documentRefs,
        conditions: [],
      },
      bcr: {
        legal: limits?.legal?.bcr.value ?? 0,
        applied: limits?.applied?.bcr.value ?? 0,
      },
      far: {
        legal: limits?.legal?.far.value ?? 0,
        incentives: [],
        applied: limits?.applied?.far.value ?? 0,
      },
      fetchedAt: now,
      basis: limits?.applied
        ? { bcr: limits.applied.bcr.basis, far: limits.applied.far.basis }
        : undefined,
      mixedZones: zones.size > 1,
    },
    provenance,
  );
}

/** 법규 계산 기준 대지면적: 공부면적 합 (공부값 없는 필지는 도형면적 폴백) */
export function officialSiteArea(parcels: Parcel[]): {
  area: number;
  allOfficial: boolean;
} {
  let area = 0;
  let allOfficial = true;
  for (const p of parcels) {
    if (p.officialArea != null) area += p.officialArea;
    else {
      area += p.area;
      allOfficial = false;
    }
  }
  return { area, allOfficial };
}
