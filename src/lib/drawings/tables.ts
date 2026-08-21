// 표 기반 도면 자동화 (M8 ②): 표제부·면적표·주차계획표. 결정론 HTML, DRAFT 워터마크 고정.

import type { ExportedProject } from "@/store/project";
import { calcParking } from "@/lib/regulation/parking";
import { labelForUse, summarizeByUse } from "@/lib/massing/zoning";

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const n = (v: number, d = 2) => v.toLocaleString("ko-KR", { maximumFractionDigits: d });

export function buildTablesHtml(p: ExportedProject): string {
  const { meta, site, regulation, program, massing } = p;
  const sc = massing.scenarios.find((s) => s.id === meta.activeScenarioId);
  const table = massing.floorTable;
  const above = table.filter((r) => r.floor > 0);
  const below = table.filter((r) => r.floor < 0);
  const aboveArea = above.reduce((s, r) => s + r.area, 0);
  const belowArea = below.reduce((s, r) => s + r.area, 0);
  const siteArea = site.parcels.reduce((s, x) => s + (x.officialArea ?? x.area), 0);
  const addr = site.parcels[0]?.addr ?? "";
  const buildingArea = sc?.footprintArea ?? 0;
  const bcr = siteArea ? (buildingArea / siteArea) * 100 : 0;
  const far = siteArea ? (aboveArea / siteArea) * 100 : 0;
  const parking = calcParking(
    program.uses.map((u) => ({ code: u.code, area: (program.grossArea * u.ratio) / 100 })),
    addr,
  );
  const byUse = summarizeByUse(above);

  const row = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(meta.name)} — 표제부·면적표·주차계획표 (DRAFT)</title>
<style>
 @page { size: A4; margin: 16mm; }
 body { font-family: -apple-system, "Malgun Gothic", sans-serif; font-size: 11px; color: #18181b; margin: 0; padding: 20px; position: relative; }
 h2 { font-size: 13px; margin: 18px 0 6px; border-bottom: 1.5px solid #18181b; padding-bottom: 3px; page-break-after: avoid; }
 table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
 th, td { border: 1px solid #a1a1aa; padding: 4px 6px; text-align: left; }
 th { background: #f4f4f5; width: 30%; font-weight: 600; }
 td.num { text-align: right; }
 tfoot td { font-weight: 600; background: #fafafa; }
 .wm { position: fixed; top: 40%; left: 10%; right: 10%; text-align: center; font-size: 96px; font-weight: 800; color: rgba(220,38,38,0.12); transform: rotate(-20deg); pointer-events: none; z-index: 0; }
 .note { color: #b45309; font-weight: 600; font-size: 10px; margin-top: 14px; border: 1.5px solid #b45309; padding: 8px; border-radius: 6px; }
 .meta { color: #71717a; font-size: 10px; }
</style></head><body>
<div class="wm">DRAFT</div>
<h1 style="font-size:17px;margin:0">${esc(meta.name)}</h1>
<p class="meta">표 기반 도면 초안 · 생성 ${esc(new Date().toLocaleString("ko-KR"))} · 건축사 검토 전 외부 반출 금지</p>

<h2>표제부 (건축개요)</h2>
<table>
${row("대지위치", esc(addr || "—"))}
${row("지역·지구", esc(regulation.useZone || "—") + (regulation.useDistrict.length ? ` 외 ${regulation.useDistrict.length}건` : ""))}
${row("대지면적", `${n(siteArea)}㎡ <span class="meta">(지적공부)</span>`)}
${row("건축면적 / 건폐율", sc ? `${n(buildingArea)}㎡ / ${n(bcr)}% <span class="meta">(법정 ${regulation.bcr.applied}%)</span>` : "— (매스 미선택)")}
${row("지상 연면적 / 용적률", `${n(aboveArea)}㎡ / ${n(far)}% <span class="meta">(법정 ${regulation.far.applied}%)</span>`)}
${row("지하 연면적", `${n(belowArea)}㎡`)}
${row("총 연면적", `${n(aboveArea + belowArea)}㎡`)}
${row("층수", `지상 ${above.length}층 / 지하 ${below.length}층`)}
${row("최고 높이", sc ? `${n(sc.height ?? 0, 1)}m <span class="meta">(층고 ${sc.floorHeight}m)</span>` : "—")}
${row("주용도", program.uses.map((u) => `${esc(u.name)} ${u.ratio}%`).join(", ") || "—")}
${row("구조", "미정 (설계 단계 확정)")}
${row("주차대수", `법정 ${parking.legal}대 / 계획 ${program.parking.recommended}대`)}
</table>

<h2>면적표</h2>
<table>
<thead><tr><th style="width:12%">층</th><th>용도</th><th style="width:22%">바닥면적(㎡)</th><th style="width:22%">비고</th></tr></thead>
<tbody>
${table.map((r) => `<tr><td>${r.floor > 0 ? `${r.floor}F` : `B${-r.floor}`}</td><td>${esc(labelForUse(r.use))}</td><td class="num">${n(r.area)}</td><td>${r.floor < 0 ? "지하 (주차·기계)" : r.area < (sc?.footprintArea ?? Infinity) - 0.5 ? "부분층" : ""}</td></tr>`).join("")}
</tbody>
<tfoot>
<tr><td colspan="2">지상 소계</td><td class="num">${n(aboveArea)}</td><td></td></tr>
<tr><td colspan="2">지하 소계</td><td class="num">${n(belowArea)}</td><td></td></tr>
<tr><td colspan="2">합계</td><td class="num">${n(aboveArea + belowArea)}</td><td></td></tr>
</tfoot>
</table>
<table>
<thead><tr><th>용도별 (지상)</th><th style="width:22%">층수</th><th style="width:22%">면적(㎡)</th><th style="width:22%">비율</th></tr></thead>
<tbody>${byUse.map((u) => `<tr><td>${esc(labelForUse(u.use))}</td><td class="num">${u.floors}</td><td class="num">${n(u.area)}</td><td class="num">${aboveArea ? n((u.area / aboveArea) * 100, 1) : 0}%</td></tr>`).join("")}</tbody>
</table>

<h2>주차계획표</h2>
<table>
<thead><tr><th>용도</th><th style="width:20%">산정면적(㎡)</th><th style="width:20%">기준</th><th style="width:20%">산정대수</th></tr></thead>
<tbody>${parking.lines.map((l) => `<tr><td>${esc(l.name)}<br><span class="meta">${esc(l.basis)}</span></td><td class="num">${n(l.area, 1)}</td><td class="num">${l.areaPerSpace}㎡/대</td><td class="num">${n(l.raw, 2)}</td></tr>`).join("") || `<tr><td colspan="4">용도 구성 없음</td></tr>`}</tbody>
<tfoot>
<tr><td colspan="3">법정 주차대수 (끝수: ${esc(parking.roundingBasis)})</td><td class="num">${parking.legal}대</td></tr>
<tr><td colspan="3">계획 주차대수 (지하 ${below.length}층, 지상 0대)</td><td class="num">${program.parking.recommended}대</td></tr>
</tfoot>
</table>

<div class="note">본 표는 매스·조닝 초안에서 자동 산출된 DRAFT입니다. 허가도서로 사용하려면 담당 건축사의 검토·수정·날인이 필요하며, 검토 전 외부 반출을 금지합니다.</div>
</body></html>`;
}
