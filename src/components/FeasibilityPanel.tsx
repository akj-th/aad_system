"use client";

// 사업성 검토 (M3). 입력은 ProjectState.feasibility.assumptions에, 결과는 results에 기록.
// 공시지가는 연속지적도 속성(jiga)에서 가져오고 나머지는 사용자 입력이다.

import { useEffect, useMemo } from "react";
import { useProjectStore } from "@/store/project";
import { officialSiteArea } from "@/lib/regulation/landinfo";
import { calcFeasibility, type FeasibilityInputs } from "@/lib/feasibility/calc";

const DEFAULTS = {
  landMultiplier: 1.5, // 공시지가 대비 실거래 배수 (사용자 입력)
  constructionUnitCost: 3_500_000,
  softCostRate: 0.1,
  financeRate: 0.06,
  loanRatio: 0.7,
  constructionMonths: 24,
  mode: 0,
  salePricePerSqm: 15_000_000,
  monthlyRentPerSqm: 40_000,
};

function won(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}억`;
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toLocaleString("ko-KR", { maximumFractionDigits: 0 })}만`;
  return `${sign}${abs.toLocaleString("ko-KR")}`;
}

function pct(n: number): string {
  return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "—";
}

// 컴포넌트 바깥에 둬야 입력마다 리마운트되어 포커스를 잃지 않는다
function NumberField({
  label,
  value,
  onChange,
  step = 1,
  suffix,
  scale = 1,
  testId,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  suffix?: string;
  scale?: number;
  testId: string;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="text-zinc-500">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          step={step}
          value={Number((value * scale).toFixed(4))}
          onChange={(e) => onChange((Number(e.target.value) || 0) / scale)}
          className="w-28 rounded border border-zinc-300 px-2 py-1 text-right"
          data-testid={testId}
        />
        {suffix && <span className="w-8 text-[10px] text-zinc-400">{suffix}</span>}
      </span>
    </label>
  );
}

export default function FeasibilityPanel() {
  const site = useProjectStore((s) => s.site);
  const program = useProjectStore((s) => s.program);
  const feasibility = useProjectStore((s) => s.feasibility);
  const updateFeasibility = useProjectStore((s) => s.updateFeasibility);

  const a = { ...DEFAULTS, ...feasibility.assumptions };
  const { area: landArea } = officialSiteArea(site.parcels);

  // 공시지가 가중평균 (원/㎡) — 연속지적도 속성
  const jigaAvg = useMemo(() => {
    const withJiga = site.parcels.filter((p) => p.jiga);
    if (withJiga.length === 0) return null;
    const total = withJiga.reduce((s, p) => s + (p.officialArea ?? p.area), 0);
    return withJiga.reduce((s, p) => s + p.jiga! * (p.officialArea ?? p.area), 0) / total;
  }, [site.parcels]);

  // 토지단가를 직접 입력한 값이 있으면 우선, 없으면 공시지가 × 배수
  const landUnitPrice =
    feasibility.assumptions.landUnitPrice ??
    (jigaAvg ? jigaAvg * a.landMultiplier : 0);

  const inputs: FeasibilityInputs = {
    landArea,
    landUnitPrice,
    grossArea: program.grossArea,
    efficiency: program.efficiency,
    constructionUnitCost: a.constructionUnitCost,
    softCostRate: a.softCostRate,
    financeRate: a.financeRate,
    loanRatio: a.loanRatio,
    constructionMonths: a.constructionMonths,
    mode: a.mode,
    salePricePerSqm: a.salePricePerSqm,
    monthlyRentPerSqm: a.monthlyRentPerSqm,
    vacancyRate: a.vacancyRate,
    capRate: a.capRate,
    discountRate: a.discountRate,
  };
  const out = calcFeasibility(inputs);

  // 결과를 ProjectState.feasibility에 기록 (값이 바뀔 때만)
  useEffect(() => {
    const r = feasibility.results;
    if (
      Math.round(r.totalCost) !== Math.round(out.totalCost) ||
      Math.round(r.NPV) !== Math.round(out.NPV) ||
      r.ROI.toFixed(4) !== out.ROI.toFixed(4)
    ) {
      updateFeasibility({
        landCost: out.landCost,
        constructionCost: out.constructionCost,
        softCost: out.softCost,
        financeCost: out.financeCost,
        revenue: { sale: out.saleRevenue, rent: out.annualNOI },
        results: {
          totalCost: out.totalCost,
          NPV: out.NPV,
          IRR: Number.isFinite(out.IRR) ? out.IRR : 0,
          ROI: out.ROI,
        },
      });
    }
  }, [out, feasibility.results, updateFeasibility]);

  function setA(patch: Record<string, number>) {
    updateFeasibility({ assumptions: { ...feasibility.assumptions, ...patch } });
  }

  const field = (props: {
    label: string;
    k: keyof typeof a;
    step?: number;
    suffix?: string;
    scale?: number;
  }) => (
    <NumberField
      label={props.label}
      value={a[props.k] as number}
      onChange={(v) => setA({ [props.k]: v })}
      step={props.step}
      suffix={props.suffix}
      scale={props.scale}
      testId={`feas-${String(props.k)}`}
    />
  );

  if (program.grossArea === 0) {
    return (
      <section className="space-y-3">
        <h1 className="text-base font-bold text-zinc-900">사업성 검토</h1>
        <p className="text-xs text-zinc-400">규모(연면적)가 정해지면 계산됩니다</p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <h1 className="text-base font-bold text-zinc-900">사업성 검토</h1>

      {/* 토지비 */}
      <div className="space-y-1 rounded bg-zinc-50 p-2">
        <p className="text-xs font-semibold text-zinc-700">토지비</p>
        <p className="text-[10px] text-zinc-400">
          공시지가 {jigaAvg ? `${won(jigaAvg)}원/㎡` : "미조회"} (개별공시지가, 연속지적도 속성) ×
          배수 → 토지단가 {won(landUnitPrice)}원/㎡ · 대지 {landArea.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}㎡(공부)
        </p>
        {field({ label: "공시지가 배수", k: "landMultiplier", step: 0.1, suffix: "배" })}
      </div>

      {/* 공사·간접·금융 */}
      <div className="space-y-1 rounded bg-zinc-50 p-2">
        <p className="text-xs font-semibold text-zinc-700">비용 가정 (사용자 입력)</p>
        {field({ label: "공사비 단가", k: "constructionUnitCost", step: 100000, suffix: "원/㎡" })}
        {field({ label: "간접비율", k: "softCostRate", step: 1, suffix: "%", scale: 100 })}
        {field({ label: "차입 비율", k: "loanRatio", step: 5, suffix: "%", scale: 100 })}
        {field({ label: "연이율", k: "financeRate", step: 0.5, suffix: "%", scale: 100 })}
        {field({ label: "공사기간", k: "constructionMonths", step: 1, suffix: "개월" })}
      </div>

      {/* 수입 */}
      <div className="space-y-1 rounded bg-zinc-50 p-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-zinc-700">수입 가정</p>
          <div className="flex gap-1 text-[11px]">
            {(["분양", "임대"] as const).map((m, idx) => (
              <button
                key={m}
                className={`rounded px-2 py-0.5 ${a.mode === idx ? "bg-blue-600 text-white" : "bg-white text-zinc-600 shadow-sm"}`}
                onClick={() => setA({ mode: idx })}
                data-testid={`feas-mode-${idx}`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[10px] text-zinc-400">
          전용면적 {out.exclusiveArea.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}㎡ = 연면적 × 전용률 {program.efficiency}
        </p>
        {a.mode === 0 ? (
          field({ label: "분양단가 (전용)", k: "salePricePerSqm", step: 500000, suffix: "원/㎡" })
        ) : (
          <>
            {field({ label: "월 임대료 (전용)", k: "monthlyRentPerSqm", step: 1000, suffix: "원/㎡" })}
            {field({ label: "공실률", k: "vacancyRate", step: 1, suffix: "%", scale: 100 })}
            {field({ label: "Cap rate", k: "capRate", step: 0.25, suffix: "%", scale: 100 })}
          </>
        )}
        {field({ label: "할인율 (NPV)", k: "discountRate", step: 0.5, suffix: "%", scale: 100 })}
      </div>

      {/* 결과 */}
      <div className="space-y-1 rounded bg-blue-50 p-3 text-xs" data-testid="feas-result">
        <table className="w-full">
          <tbody>
            <tr><td className="text-zinc-500">토지비</td><td className="text-right">{won(out.landCost)}</td></tr>
            <tr><td className="text-zinc-500">공사비</td><td className="text-right">{won(out.constructionCost)}</td></tr>
            <tr><td className="text-zinc-500">간접비</td><td className="text-right">{won(out.softCost)}</td></tr>
            <tr><td className="text-zinc-500">금융비</td><td className="text-right">{won(out.financeCost)}</td></tr>
            <tr className="border-t border-blue-200 font-semibold">
              <td>총사업비</td><td className="text-right" data-testid="feas-total">{won(out.totalCost)}</td>
            </tr>
            <tr>
              <td className="text-zinc-500">{a.mode === 1 ? "자산가치 (NOI/cap)" : "분양수입"}</td>
              <td className="text-right">{won(out.revenue)}</td>
            </tr>
            <tr className="border-t border-blue-200 font-semibold">
              <td>사업이익</td>
              <td className={`text-right ${out.profit < 0 ? "text-red-600" : ""}`}>{won(out.profit)}</td>
            </tr>
            <tr><td className="text-zinc-500">ROI</td><td className="text-right" data-testid="feas-roi">{pct(out.ROI)}</td></tr>
            <tr><td className="text-zinc-500">NPV @{pct(a.discountRate)}</td><td className="text-right">{won(out.NPV)}</td></tr>
            <tr><td className="text-zinc-500">IRR (연)</td><td className="text-right">{pct(out.IRR)}</td></tr>
          </tbody>
        </table>
        <p className="text-[10px] text-zinc-400">
          현금흐름(억): {out.cashflows.map((c) => (c / 1e8).toFixed(1)).join(" / ")} — 0년 토지비, 공사기간 균등, 준공연도 수입
        </p>
      </div>

      <p className="border-t border-zinc-200 pt-2 text-[10px] font-medium text-amber-700">
        가정값 기반 개략 검토 — 세금·분양률·운영비 미반영. 최종 확인은 담당자 책임
      </p>
    </section>
  );
}
