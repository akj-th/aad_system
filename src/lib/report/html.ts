// 기획 검토 리포트 HTML 생성 (M9). 결정론 — 상태와 계산 결과만 조립한다. AI 문장 없음.
// 인쇄(PDF) 친화적인 독립 문서로 만들어 iframe/새 창에서 바로 print()할 수 있다.

import type { ExportedProject } from "@/store/project";
import { calcAreas, lookupZoneLimits } from "@/lib/regulation/calc";
import { calcParking } from "@/lib/regulation/parking";
import { checkSunlight } from "@/lib/regulation/sunlight";
import { calcFeasibility } from "@/lib/feasibility/calc";
import { labelForUse, summarizeByUse } from "@/lib/massing/zoning";
import { resolveDrawings } from "@/lib/drawings/list";

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
const n = (v: number, d = 1) =>
  Number.isFinite(v) ? v.toLocaleString("ko-KR", { maximumFractionDigits: d }) : "—";
const won = (v: number) =>
  Number.isFinite(v) ? `${(v / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}억원` : "—";
const pct = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : "—");

const DISCLAIMER =
  "본 문서는 자동 산출된 참고용 검토 자료이며, 법규·면적·사업성 수치의 최종 확인 책임은 담당 건축사에게 있습니다. AI 생성 이미지는 실제 설계안과 재질·주변 환경이 다를 수 있습니다.";

export function buildReportHtml(p: ExportedProject): string {
  const { meta, site, regulation, program, feasibility, provenance } = p;
  const officialArea = site.parcels.reduce((s, x) => s + (x.officialArea ?? x.area), 0);
  const allOfficial = site.parcels.every((x) => x.officialArea != null);
  const addr = site.parcels[0]?.addr ?? "";
  const floorHeight = program.floorHeight ?? 3;

  const areas =
    regulation.bcr.applied > 0
      ? calcAreas(officialArea, regulation.bcr.applied, regulation.far.applied, floorHeight)
      : null;
  const limits = regulation.useZone ? lookupZoneLimits(regulation.useZone, addr) : null;
  const sunlight =
    regulation.useZone && areas
      ? checkSunlight(regulation.useZone, areas.estHeight, site.boundary)
      : null;
  const parking =
    program.uses.length > 0
      ? calcParking(
          program.uses.map((u) => ({ code: u.code, area: (program.grossArea * u.ratio) / 100 })),
          addr,
        )
      : null;

  const a = feasibility.assumptions;
  const jigaAvg = (() => {
    const w = site.parcels.filter((x) => x.jiga);
    if (!w.length) return 0;
    const tot = w.reduce((s, x) => s + (x.officialArea ?? x.area), 0);
    return w.reduce((s, x) => s + x.jiga! * (x.officialArea ?? x.area), 0) / tot;
  })();
  const feas =
    program.grossArea > 0
      ? calcFeasibility({
          landArea: officialArea,
          landUnitPrice: a.landUnitPrice ?? jigaAvg * (a.landMultiplier ?? 1.5),
          grossArea: program.grossArea,
          efficiency: program.efficiency,
          constructionUnitCost: a.constructionUnitCost ?? 3_500_000,
          softCostRate: a.softCostRate ?? 0.1,
          financeRate: a.financeRate ?? 0.06,
          loanRatio: a.loanRatio ?? 0.7,
          constructionMonths: a.constructionMonths ?? 24,
          mode: a.mode ?? 0,
          salePricePerSqm: a.salePricePerSqm ?? 15_000_000,
          monthlyRentPerSqm: a.monthlyRentPerSqm ?? 40_000,
          vacancyRate: a.vacancyRate,
          capRate: a.capRate,
          discountRate: a.discountRate,
        })
      : null;

  const latestRender = p.m7Captures.flatMap((c) => c.renders.map((r) => ({ c, r })))[0];
  const latestCapture = p.m7Captures[0];

  // 매스·조닝·도서 (M4/M5/M8)
  const scenarios = p.massing.scenarios;
  const activeSc = scenarios.find((s) => s.id === meta.activeScenarioId);
  const floorTable = p.massing.floorTable;
  const aboveRows = floorTable.filter((r) => r.floor > 0);
  const belowRows = floorTable.filter((r) => r.floor < 0);
  const drawings = activeSc
    ? resolveDrawings({
        floors: activeSc.floors,
        basementFloors: belowRows.length,
        grossArea: program.grossArea,
        siteArea: officialArea,
        excavationDepth: belowRows.length * activeSc.floorHeight,
      })
    : [];

  const row = (k: string, v: string, basis?: string) =>
    `<tr><th>${esc(k)}</th><td>${v}</td><td class="basis">${esc(basis ?? "")}</td></tr>`;

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>${esc(meta.name)} — 기획 검토 리포트</title>
<style>
  @page { size: A4; margin: 18mm; }
  body { font-family: -apple-system, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif; color: #18181b; font-size: 11px; line-height: 1.5; margin: 0; padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 13px; margin: 22px 0 6px; padding-bottom: 3px; border-bottom: 1.5px solid #18181b; page-break-after: avoid; }
  .meta { color: #71717a; font-size: 10px; }
  table { width: 100%; border-collapse: collapse; margin: 4px 0; }
  th, td { text-align: left; padding: 3px 6px; border-bottom: 1px solid #e4e4e7; vertical-align: top; }
  th { width: 32%; font-weight: 600; color: #3f3f46; background: #fafafa; }
  td.basis { width: 34%; color: #71717a; font-size: 9.5px; }
  .kpi { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 6px 0; }
  .kpi div { border: 1px solid #e4e4e7; border-radius: 6px; padding: 8px; }
  .kpi b { display: block; font-size: 15px; }
  .kpi span { color: #71717a; font-size: 9.5px; }
  .imgs { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .imgs img { width: 100%; border: 1px solid #e4e4e7; border-radius: 4px; }
  .caption { font-size: 9.5px; color: #71717a; }
  .warn { color: #b45309; }
  .disclaimer { margin-top: 26px; padding: 10px; border: 1.5px solid #b45309; border-radius: 6px; color: #92400e; font-weight: 600; page-break-inside: avoid; }
  .prov td, .prov th { font-size: 9.5px; }
</style></head><body>
<h1>${esc(meta.name)}</h1>
<p class="meta">기획 검토 리포트 · 생성 ${esc(new Date().toLocaleString("ko-KR"))} · 프로젝트 ID ${esc(meta.id.slice(0, 8))}</p>

<h2>1. 대지 개요</h2>
<table>
${row("소재지", esc(addr || "—"))}
${row("필지", site.parcels.map((x) => `${esc(x.jibun ?? x.pnu)}${x.useZone ? ` (${esc(x.useZone)})` : ""}`).join(", ") || "—", site.operation === "merge" ? `합필 ${site.parcels.length}필지 (geometry union)` : "단필")}
${row("대지면적 (계산 기준)", `${n(officialArea)}㎡ (${n(officialArea / 3.3058)}평)`, allOfficial ? "지적공부 면적 합 (토지특성 API)" : "일부 필지 도형면적 폴백")}
${row("대지면적 (도형)", `${n(site.area)}㎡`, "연속지적도 geometry 기준 — 병기")}
${row("용도지역", esc(regulation.useZone || "미조회"), regulation.fetchedAt ? `토지특성 API · ${new Date(regulation.fetchedAt).toLocaleString("ko-KR")}` : "")}
${row("용도지구·구역 등", regulation.useDistrict.map(esc).join(", ") || "—", "토지이용계획 API")}
</table>
${regulation.mixedZones ? `<p class="warn">⚠ 합필 필지 간 용도지역이 달라 대표 용도지역 기준으로 계산했습니다 (안분 미지원).</p>` : ""}

<h2>2. 법규 검토 (계산부)</h2>
<table>
${row("건폐율 법정 상한", `${regulation.bcr.legal}%`, limits?.legal?.bcr.basis)}
${row("건폐율 적용", `<b>${regulation.bcr.applied}%</b>`, regulation.basis?.bcr)}
${row("용적률 법정 상한", `${regulation.far.legal}%`, limits?.legal?.far.basis)}
${row("용적률 적용", `<b>${regulation.far.applied}%</b>`, regulation.basis?.far)}
${areas ? row("최대 건축면적", `<b>${n(areas.maxBuildingArea)}㎡</b>`, `${n(officialArea)}㎡ × ${regulation.bcr.applied}%`) : ""}
${areas ? row("최대 연면적", `<b>${n(areas.maxGrossArea)}㎡</b>`, `${n(officialArea)}㎡ × ${regulation.far.applied}%`) : ""}
${areas ? row("개략 층수·높이", `${areas.estFloors}층 · ${n(areas.estHeight)}m`, `층고 ${floorHeight}m 사용자 입력, 기준층=최대 건축면적 가정`) : ""}
${sunlight ? row("정북일조 (개략)", sunlight.applies ? `필요 이격 ${n(sunlight.requiredSetback)}m${sunlight.siteDepthNS !== null ? ` · 남북 가용 깊이 약 ${n(sunlight.usableDepthNS ?? 0, 0)}m` : ""}` : "미적용 용도지역", sunlight.basis) : ""}
</table>
<p class="caption">${limits?.localNote ? esc(limits.localNote) + " · " : ""}일조·사선 정밀 검토, 가로구역별 높이제한, 지구단위계획 지침은 미반영.</p>

<h2>3. 규모 계획</h2>
${program.grossArea > 0 ? `<table>
${row("계획 연면적", `${n(program.grossArea, 0)}㎡`, areas && program.grossArea > areas.maxGrossArea + 0.5 ? "⚠ 법정 최대 초과" : "사용자 입력")}
${row("전용률 · 전용면적", `${program.efficiency} · ${n(program.grossArea * program.efficiency, 0)}㎡`, "사용자 입력")}
${row("용도 구성", program.uses.map((u) => `${esc(u.name)} ${u.ratio}%`).join("<br>") || "—")}
${parking ? row("법정 주차대수", `<b>${parking.legal}대</b> (산정 ${n(parking.rawTotal, 2)})`, `${parking.tableName} · 끝수 ${parking.roundingBasis}`) : ""}
</table>
${parking ? `<table class="prov">${parking.lines.map((l) => `<tr><th>${esc(l.name)}</th><td>${n(l.area, 0)}㎡ ÷ ${l.areaPerSpace} = ${n(l.raw, 2)}대${l.caveat ? `<br><span class="warn">⚠ ${esc(l.caveat)}</span>` : ""}</td><td class="basis">${esc(l.basis)}</td></tr>`).join("")}</table>` : ""}` : `<p class="caption">규모 미설정</p>`}

${scenarios.length ? `<h2>3-1. 매스 대안 비교 (규칙 기반)</h2>
<table><tr><th>대안</th><td>바닥면적 · 건폐율</td><td>층수 · 높이</td><td>연면적</td><td class="basis">정북일조(개략)</td></tr>
${scenarios.map((s) => `<tr${s.id === activeSc?.id ? ' style="background:#f5f3ff"' : ""}><th>${esc(s.name)}${s.id === activeSc?.id ? " ★" : ""}</th><td>${n(s.footprintArea ?? 0, 0)}㎡ · ${n(s.bcr)}%</td><td>${s.floors}층 · ${n(s.height ?? 0)}m</td><td>${n(s.grossFloorArea, 0)}㎡</td><td class="basis">${s.sunlightOk ? "통과" : "검토 필요"} (이격 ${n(s.sunlightSetback ?? 0)}m)</td></tr>`).join("")}
</table>
<p class="caption">대지 경계를 중심 축척한 바닥 × 법정 최대 연면적 ÷ 바닥 = 층수. 배치·형태는 설계 판단으로 확정.</p>` : ""}
${floorTable.length ? `<h2>3-2. 층별 면적표 (${esc(activeSc?.name ?? "")})</h2>
<table class="prov"><tr><th>층</th><td>용도</td><td>바닥면적</td></tr>
${floorTable.map((r) => `<tr><th>${r.floor > 0 ? `${r.floor}F` : `B${-r.floor}`}</th><td>${esc(labelForUse(r.use))}</td><td>${n(r.area, 1)}㎡</td></tr>`).join("")}
<tr><th>지상 소계 / 지하 소계</th><td colspan="2">${n(aboveRows.reduce((s, r) => s + r.area, 0), 1)}㎡ / ${n(belowRows.reduce((s, r) => s + r.area, 0), 1)}㎡</td></tr>
</table>
<table class="prov">${summarizeByUse(aboveRows).map((u) => `<tr><th>${esc(labelForUse(u.use))}</th><td>${u.floors}개층</td><td>${n(u.area, 1)}㎡</td></tr>`).join("")}</table>` : ""}

<h2>4. 사업성 검토 (개략)</h2>
${feas ? `<div class="kpi">
<div><span>총사업비</span><b>${won(feas.totalCost)}</b></div>
<div><span>${(a.mode ?? 0) === 1 ? "자산가치" : "분양수입"}</span><b>${won(feas.revenue)}</b></div>
<div><span>ROI</span><b>${pct(feas.ROI)}</b></div>
<div><span>NPV @${pct(a.discountRate)} · IRR</span><b>${won(feas.NPV)} · ${pct(feas.IRR)}</b></div>
</div>
<table>
${row("토지비", won(feas.landCost), `공시지가 ${n(jigaAvg, 0)}원/㎡ × ${a.landMultiplier ?? 1.5}배 (개별공시지가 + 사용자 배수)`)}
${row("공사비", won(feas.constructionCost), `${n(a.constructionUnitCost ?? 3_500_000, 0)}원/㎡ 사용자 입력`)}
${row("간접비 · 금융비", `${won(feas.softCost)} · ${won(feas.financeCost)}`, `간접 ${pct(a.softCostRate ?? 0.1)}, 차입 ${pct(a.loanRatio ?? 0.7)} × 연 ${pct(a.financeRate ?? 0.06)} × ${a.constructionMonths ?? 24}개월 (평균잔액)`)}
${row("현금흐름(억)", feas.cashflows.map((c) => (c / 1e8).toFixed(1)).join(" / "), "0년 토지비, 공사기간 균등, 준공연도 수입")}
</table>
<p class="caption">세금·분양률·운영비 미반영. 모든 단가는 사용자 가정값.</p>` : `<p class="caption">규모 미설정으로 미산정</p>`}

<h2>5. 이미지</h2>
${latestCapture ? `<div class="imgs">
<div><img src="${latestCapture.beauty}" alt="3D 뷰"><p class="caption">3D 뷰 (브이월드 + 배치 모델) · 카메라 고도 ${n(latestCapture.camera.height, 0)}m, pitch ${n(latestCapture.camera.pitch, 0)}°</p></div>
${latestRender ? `<div><img src="${latestRender.r.image}" alt="AI 렌더"><p class="caption">AI 생성 — 실제 설계안과 재질·주변 환경이 다를 수 있음 · ${esc(latestRender.r.options.material)}</p></div>` : ""}
</div>` : `<p class="caption">캡처 없음</p>`}

${drawings.length ? `<h2>6. 허가도서 준비 현황 (DRAFT)</h2>
<table class="prov"><tr><th>도서</th><td>필요</td><td class="basis">근거</td></tr>
${drawings.map((d) => `<tr><th>${esc(d.name)}</th><td>${d.required ? "필요" : "해당 없음"}${d.auto ? " · 자동 산출" : ""}</td><td class="basis">${esc(d.basis)}${d.reason ? ` — ${esc(d.reason)}` : ""}</td></tr>`).join("")}
</table>
<p class="caption">면적표·주차계획표·IFC 매스는 자동 산출되며, 본 도면은 건축사가 작성·검토한다.</p>` : ""}

<h2>${drawings.length ? 7 : 6}. 근거 목록 (provenance)</h2>
<table class="prov"><tr><th>항목</th><td>값</td><td class="basis">출처 · 근거</td></tr>
${provenance.slice(-30).map((e) => `<tr><th>${esc(e.field)}</th><td>${esc(typeof e.value === "number" ? n(e.value) : e.value)}</td><td class="basis">${esc(e.source)} · ${esc(e.basis ?? "")}</td></tr>`).join("")}
</table>

<div class="disclaimer">${DISCLAIMER}</div>
</body></html>`;
}
