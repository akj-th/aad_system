// 사업성 검토 계산기 (M3). A-5: 재무 계산은 결정론 코드 — AI 없음.
// 단순 모델: 토지비(0년) → 공사비·간접비(공사기간 균등) → 준공 시 분양수입 또는 자산가치.

export interface FeasibilityInputs {
  /** 계산 기준 대지면적(㎡, 공부면적) */
  landArea: number;
  /** 토지 단가(원/㎡). 기본값 = 공시지가 × 배수 */
  landUnitPrice: number;
  /** 연면적(㎡) */
  grossArea: number;
  /** 전용률 */
  efficiency: number;
  /** 공사비 단가(원/㎡ 연면적) */
  constructionUnitCost: number;
  /** 간접비율 (공사비 대비) */
  softCostRate: number;
  /** 연이율 */
  financeRate: number;
  /** 차입 비율 (총 직접비 대비) */
  loanRatio: number;
  /** 공사기간(개월) */
  constructionMonths: number;
  /** 0=분양, 1=임대 */
  mode: number;
  /** 분양단가 (원/전용㎡) */
  salePricePerSqm: number;
  /** 월 임대료 (원/전용㎡·월) */
  monthlyRentPerSqm: number;
  vacancyRate: number;
  capRate: number;
  discountRate: number;
}

export interface FeasibilityOutputs {
  landCost: number;
  constructionCost: number;
  softCost: number;
  financeCost: number;
  totalCost: number;
  exclusiveArea: number;
  saleRevenue: number;
  /** 임대: 연 NOI(공실 반영) */
  annualNOI: number;
  /** 임대: 자산가치 = NOI / capRate */
  assetValue: number;
  revenue: number;
  profit: number;
  ROI: number;
  NPV: number;
  /** 연 IRR. 수렴 실패 시 NaN */
  IRR: number;
  /** 연도별 현금흐름 (0년 = 착수) */
  cashflows: number[];
}

export function npv(rate: number, cashflows: number[]): number {
  return cashflows.reduce((sum, cf, t) => sum + cf / Math.pow(1 + rate, t), 0);
}

/** IRR — 이분법. 부호 변화가 없으면 NaN */
export function irr(cashflows: number[]): number {
  let lo = -0.99;
  let hi = 10;
  const f = (r: number) => npv(r, cashflows);
  if (f(lo) * f(hi) > 0) return NaN;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(lo) * f(mid) <= 0) hi = mid;
    else lo = mid;
    if (hi - lo < 1e-7) break;
  }
  return (lo + hi) / 2;
}

export function calcFeasibility(i: FeasibilityInputs): FeasibilityOutputs {
  const landCost = i.landArea * i.landUnitPrice;
  const constructionCost = i.grossArea * i.constructionUnitCost;
  const softCost = constructionCost * i.softCostRate;
  const directCost = landCost + constructionCost + softCost;
  // 평균 잔액 = 차입금의 1/2 × 기간 (공사비 균등 집행 가정)
  const financeCost =
    directCost * i.loanRatio * i.financeRate * (i.constructionMonths / 12) * 0.5;
  const totalCost = directCost + financeCost;

  const exclusiveArea = i.grossArea * i.efficiency;
  const saleRevenue = exclusiveArea * i.salePricePerSqm;
  const annualNOI = exclusiveArea * i.monthlyRentPerSqm * 12 * (1 - i.vacancyRate);
  const assetValue = i.capRate > 0 ? annualNOI / i.capRate : 0;
  const revenue = i.mode === 1 ? assetValue : saleRevenue;

  const profit = revenue - totalCost;
  const ROI = totalCost > 0 ? profit / totalCost : 0;

  // 현금흐름: 0년 토지비, 공사기간 동안 공사비·간접비·금융비 균등, 준공연도에 수입
  const years = Math.max(1, Math.ceil(i.constructionMonths / 12));
  const cashflows: number[] = new Array(years + 1).fill(0);
  cashflows[0] -= landCost;
  const perYear = (constructionCost + softCost + financeCost) / years;
  for (let y = 1; y <= years; y++) cashflows[y] -= perYear;
  cashflows[years] += revenue;

  return {
    landCost,
    constructionCost,
    softCost,
    financeCost,
    totalCost,
    exclusiveArea,
    saleRevenue,
    annualNOI,
    assetValue,
    revenue,
    profit,
    ROI,
    NPV: npv(i.discountRate, cashflows),
    IRR: irr(cashflows),
    cashflows,
  };
}
