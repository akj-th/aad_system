// 최소 IFC4 내보내기 (M8 ③). 매스 바닥 폴리곤을 층별 압출체(IfcBuildingElementProxy)로 써서
// Revit/ArchiCAD가 읽을 수 있는 매스 모델을 넘긴다. 정밀 BIM이 아니라 핸드오프용.

import type { ExportedProject } from "@/store/project";
import { toLocalMeters } from "@/lib/plan/diagram";
import { centroid } from "@turf/turf";

// IFC GUID: UUID 128bit → 22자 base64(IFC 전용 알파벳)
const IFC64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
function ifcGuid(): string {
  const hex = crypto.randomUUID().replace(/-/g, "");
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  // 첫 2비트는 0이어야 22자에 들어간다 (표준 압축: 첫 문자 ≤ 3)
  let out = "";
  let n = BigInt(0);
  for (const b of bytes) n = (n << BigInt(8)) | BigInt(b);
  for (let i = 21; i >= 0; i--) {
    out = IFC64[Number(n & BigInt(63))] + out;
    n >>= BigInt(6);
  }
  return out;
}

function dms(deg: number): string {
  const sign = deg < 0 ? -1 : 1;
  const a = Math.abs(deg);
  const d = Math.floor(a);
  const m = Math.floor((a - d) * 60);
  const s = Math.floor(((a - d) * 60 - m) * 60);
  const us = Math.round((((a - d) * 60 - m) * 60 - s) * 1e6);
  return `(${sign * d},${sign * m},${sign * s},${sign * us})`;
}

const f = (v: number) => {
  const s = v.toFixed(4).replace(/\.?0+$/, "");
  return s.includes(".") ? s : `${s}.`;
};

export function buildIfc(p: ExportedProject): string | null {
  const sc = p.massing.scenarios.find((s) => s.id === p.meta.activeScenarioId);
  if (!sc?.footprint) return null;

  const table = p.massing.floorTable.length
    ? p.massing.floorTable
    : Array.from({ length: sc.floors }, (_, i) => ({ floor: i + 1, use: "other", area: sc.footprintArea ?? 0 }));
  const { rings } = toLocalMeters(sc.footprint);
  const c = centroid({ type: "Feature", properties: {}, geometry: sc.footprint }).geometry.coordinates;
  const fh = sc.floorHeight;
  const baseElev = p.massing.placement?.baseHeight ?? 0;

  const lines: string[] = [];
  let id = 0;
  const add = (s: string) => {
    id += 1;
    lines.push(`#${id}=${s};`);
    return id;
  };

  const person = add(`IFCPERSON($,'AAD',$,$,$,$,$,$)`);
  const org = add(`IFCORGANIZATION($,'AAD System',$,$,$)`);
  const po = add(`IFCPERSONANDORGANIZATION(#${person},#${org},$)`);
  const app = add(`IFCAPPLICATION(#${org},'0.1','AAD System','AAD')`);
  const owner = add(`IFCOWNERHISTORY(#${po},#${app},$,.ADDED.,$,$,$,${Math.floor(Date.now() / 1000)})`);
  const uLen = add(`IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)`);
  const uArea = add(`IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)`);
  const uVol = add(`IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)`);
  const units = add(`IFCUNITASSIGNMENT((#${uLen},#${uArea},#${uVol}))`);
  const origin = add(`IFCCARTESIANPOINT((0.,0.,0.))`);
  const zAxis = add(`IFCDIRECTION((0.,0.,1.))`);
  const xAxis = add(`IFCDIRECTION((1.,0.,0.))`);
  const wcs = add(`IFCAXIS2PLACEMENT3D(#${origin},#${zAxis},#${xAxis})`);
  const ctx = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#${wcs},$)`);
  const project = add(`IFCPROJECT('${ifcGuid()}',#${owner},'${p.meta.name.replace(/'/g, "")}',$,$,$,$,(#${ctx}),#${units})`);
  const sitePl = add(`IFCLOCALPLACEMENT($,#${wcs})`);
  const site = add(
    `IFCSITE('${ifcGuid()}',#${owner},'Site',$,$,#${sitePl},$,$,.ELEMENT.,${dms(c[1])},${dms(c[0])},${f(baseElev)},$,$)`,
  );
  const bldgPl = add(`IFCLOCALPLACEMENT(#${sitePl},#${wcs})`);
  const bldg = add(`IFCBUILDING('${ifcGuid()}',#${owner},'${sc.name}',$,$,#${bldgPl},$,$,.ELEMENT.,$,$,$)`);
  add(`IFCRELAGGREGATES('${ifcGuid()}',#${owner},$,$,#${project},(#${site}))`);
  add(`IFCRELAGGREGATES('${ifcGuid()}',#${owner},$,$,#${site},(#${bldg}))`);

  const storeyIds: number[] = [];
  for (const row of [...table].sort((a, b) => a.floor - b.floor)) {
    const z = row.floor > 0 ? (row.floor - 1) * fh : row.floor * fh;
    const pt = add(`IFCCARTESIANPOINT((0.,0.,${f(z)}))`);
    const ax = add(`IFCAXIS2PLACEMENT3D(#${pt},#${zAxis},#${xAxis})`);
    const pl = add(`IFCLOCALPLACEMENT(#${bldgPl},#${ax})`);
    const label = row.floor > 0 ? `${row.floor}F` : `B${-row.floor}`;
    const storey = add(`IFCBUILDINGSTOREY('${ifcGuid()}',#${owner},'${label}',$,$,#${pl},$,$,.ELEMENT.,${f(z)})`);
    storeyIds.push(storey);

    const proxies: number[] = [];
    rings.forEach((ring, ri) => {
      // 부분층(최상층)은 면적 비율만큼 축척해 표현
      const full = sc.footprintArea ?? row.area;
      const k = row.area < full - 0.5 ? Math.sqrt(row.area / full) : 1;
      const pts = ring.map(([x, y]) => add(`IFCCARTESIANPOINT((${f(x * k)},${f(y * k)}))`));
      const poly = add(`IFCPOLYLINE((${[...pts, pts[0]].map((i) => `#${i}`).join(",")}))`);
      const prof = add(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#${poly})`);
      const solid = add(`IFCEXTRUDEDAREASOLID(#${prof},#${wcs},#${zAxis},${f(fh)})`);
      const rep = add(`IFCSHAPEREPRESENTATION(#${ctx},'Body','SweptSolid',(#${solid}))`);
      const pds = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${rep}))`);
      const elPl = add(`IFCLOCALPLACEMENT(#${pl},#${wcs})`);
      proxies.push(
        add(`IFCBUILDINGELEMENTPROXY('${ifcGuid()}',#${owner},'Mass ${label}${rings.length > 1 ? `-${ri + 1}` : ""} (${row.use})',$,$,#${elPl},#${pds},$,$)`),
      );
    });
    add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${ifcGuid()}',#${owner},$,$,(${proxies.map((i) => `#${i}`).join(",")}),#${storey})`);
  }
  add(`IFCRELAGGREGATES('${ifcGuid()}',#${owner},$,$,#${bldg},(${storeyIds.map((i) => `#${i}`).join(",")}))`);

  const ts = new Date().toISOString().slice(0, 19);
  return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [CoordinationView]','AAD mass handoff - DRAFT'),'2;1');
FILE_NAME('${p.meta.name.replace(/'/g, "")}.ifc','${ts}',('AAD System'),('AAD'),'AAD System 0.1','AAD System','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
${lines.join("\n")}
ENDSEC;
END-ISO-10303-21;
`;
}
