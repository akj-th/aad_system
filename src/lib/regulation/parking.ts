// 부설주차장 법정 대수 산정 (결정론). 기준값은 parking.json에서만 온다.

import parking from "@/data/regulations/parking.json";

interface ParkingTable {
  id: string;
  name: string;
  shortName: string;
  jurisdictionPrefix?: string;
  article: string;
  areaPerSpace: Record<string, number>;
  caveats?: Record<string, string>;
}

interface ParkingData {
  rounding: { threshold: number; basis: string };
  categories: { code: string; name: string; short: string }[];
  tables: ParkingTable[];
}

const DATA = parking as ParkingData;

export const PARKING_CATEGORIES = DATA.categories;

export interface UseArea {
  code: string;
  area: number;
}

export interface ParkingLine {
  code: string;
  name: string;
  area: number;
  areaPerSpace: number;
  /** 끝수 처리 전 산정값 */
  raw: number;
  basis: string;
  caveat?: string;
}

export interface ParkingResult {
  lines: ParkingLine[];
  /** 끝수 처리 전 합계 */
  rawTotal: number;
  /** 법정 대수 (끝수 처리 후) */
  legal: number;
  roundingBasis: string;
  tableName: string;
  /** 비교용: 시행령 기준으로 계산한 대수 */
  nationalLegal: number;
}

function pickTable(addr: string): ParkingTable {
  return (
    DATA.tables.find(
      (t) => t.jurisdictionPrefix && addr.startsWith(t.jurisdictionPrefix),
    ) ?? DATA.tables.find((t) => t.id === "national")!
  );
}

function roundTotal(raw: number): number {
  const whole = Math.floor(raw);
  return raw - whole >= DATA.rounding.threshold ? whole + 1 : whole;
}

export function calcParking(uses: UseArea[], addr: string): ParkingResult {
  const table = pickTable(addr);
  const national = DATA.tables.find((t) => t.id === "national")!;

  const lines: ParkingLine[] = uses
    .filter((u) => u.area > 0)
    .map((u) => {
      const per = table.areaPerSpace[u.code] ?? table.areaPerSpace.other;
      const name =
        DATA.categories.find((c) => c.code === u.code)?.name ?? u.code;
      return {
        code: u.code,
        name,
        area: u.area,
        areaPerSpace: per,
        raw: u.area / per,
        basis: `${table.shortName} ${table.article} (${per}㎡당 1대)`,
        caveat: table.caveats?.[u.code],
      };
    });

  const rawTotal = lines.reduce((s, l) => s + l.raw, 0);
  const nationalRaw = uses
    .filter((u) => u.area > 0)
    .reduce(
      (s, u) =>
        s + u.area / (national.areaPerSpace[u.code] ?? national.areaPerSpace.other),
      0,
    );

  return {
    lines,
    rawTotal,
    legal: roundTotal(rawTotal),
    roundingBasis: DATA.rounding.basis,
    tableName: table.name,
    nationalLegal: roundTotal(nationalRaw),
  };
}
