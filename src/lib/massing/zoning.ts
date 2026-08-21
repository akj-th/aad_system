// 층별 용도 배분 (M5 조닝, 결정론). 적층 순서·지하 주차 소요면적은 parking.json에서 온다.

import parking from "@/data/regulations/parking.json";
import type { FloorArea, MassScenario, ProgramUse } from "@/types/project";

interface ParkingJson {
  categories: { code: string; name: string; short: string; stackOrder?: number }[];
  basement: { areaPerSpaceWithAisle: number; basis: string };
}
const DATA = parking as unknown as ParkingJson;

export const PARKING_USE_CODE = "parking";

export function labelForUse(code: string): string {
  if (code === PARKING_USE_CODE) return "주차장";
  return DATA.categories.find((c) => c.code === code)?.short ?? code;
}

export function basementBasis(): string {
  return `${DATA.basement.areaPerSpaceWithAisle}㎡/대 — ${DATA.basement.basis}`;
}

/**
 * 지상층: 바닥면적씩 채우되 최상층은 부분층. 용도는 stackOrder가 낮은 것부터 저층에,
 * 각 용도 목표면적(연면적 × 비율)을 누적으로 채우면 다음 용도로 넘어간다.
 * 지하층: 법정 주차대수 × 소요면적 ÷ 바닥면적 → 층수 (바닥 = 지상 바닥 가정).
 */
export function generateFloorTable(
  scenario: MassScenario,
  uses: ProgramUse[],
  parkingLegal: number,
): FloorArea[] {
  const footprint = scenario.footprintArea ?? scenario.grossFloorArea / scenario.floors;
  const gfa = scenario.grossFloorArea;
  const ordered = [...uses]
    .filter((u) => u.ratio > 0)
    .sort(
      (a, b) =>
        (DATA.categories.find((c) => c.code === a.code)?.stackOrder ?? 99) -
        (DATA.categories.find((c) => c.code === b.code)?.stackOrder ?? 99),
    );
  const targets = ordered.map((u) => ({ code: u.code, remaining: (gfa * u.ratio) / 100 }));

  const table: FloorArea[] = [];
  let ti = 0;
  for (let f = 1; f <= scenario.floors; f++) {
    const area = f === scenario.floors ? Math.max(0, gfa - footprint * (scenario.floors - 1)) : footprint;
    // 남은 목표가 0 이하인 용도는 건너뛴다
    while (ti < targets.length - 1 && targets[ti].remaining <= 0.5) ti++;
    const code = targets[ti]?.code ?? ordered[0]?.code ?? "other";
    if (targets[ti]) targets[ti].remaining -= area;
    table.push({ floor: f, use: code, area });
  }

  const basementFloors =
    parkingLegal > 0 && footprint > 0
      ? Math.ceil((parkingLegal * DATA.basement.areaPerSpaceWithAisle) / footprint)
      : 0;
  for (let b = 1; b <= basementFloors; b++) {
    table.push({ floor: -b, use: PARKING_USE_CODE, area: footprint });
  }
  return table.sort((a, b) => b.floor - a.floor);
}

export function summarizeByUse(table: FloorArea[]): { use: string; area: number; floors: number }[] {
  const m = new Map<string, { area: number; floors: number }>();
  for (const r of table) {
    const e = m.get(r.use) ?? { area: 0, floors: 0 };
    e.area += r.area;
    e.floors += 1;
    m.set(r.use, e);
  }
  return [...m.entries()].map(([use, v]) => ({ use, ...v }));
}
