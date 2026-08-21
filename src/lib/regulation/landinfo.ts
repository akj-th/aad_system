// 대지 선택 시 토지특성·토지이용계획을 자동 조회해 ProjectState.regulation에
// 반영하는 클라이언트 헬퍼. 판단·계산은 lookupZoneLimits/calcAreas(결정론)가 한다.

import type { Parcel, ProvenanceEntry } from "@/types/project";
import type { LandInfo } from "@/app/api/vworld/landinfo/route";
import { useProjectStore } from "@/store/project";
import { lookupZoneLimits } from "./calc";

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

  const byPnu: Record<string, { officialArea?: number; useZone?: string }> = {};
  infos.forEach((info) => {
    if (info) {
      byPnu[info.pnu] = {
        officialArea: info.officialArea ?? undefined,
        useZone: info.useZone ?? undefined,
      };
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

  mergeParcelLandInfo(byPnu);
  setRegulation(
    {
      useZone,
      useDistrict,
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
