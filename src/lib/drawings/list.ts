// 필요 도서 목록 자동 산출 (M8 ①). 규칙은 drawings.json에서만 온다.

import drawings from "@/data/regulations/drawings.json";

interface When {
  floorsAtLeast?: number;
  grossAreaAtLeast?: number;
  siteAreaAtLeast?: number;
  basementFloorsAtLeast?: number;
  excavationDepthAtLeast?: number;
  /** true면 조건 중 하나만 맞아도 됨 (기본은 모두) */
  any?: boolean;
}

interface DrawingRule {
  code: string;
  name: string;
  basis: string;
  auto?: boolean;
  when?: When;
}

interface DrawingsJson {
  note: string;
  base: DrawingRule[];
  conditional: DrawingRule[];
}

const DATA = drawings as DrawingsJson;
export const DRAWINGS_NOTE = DATA.note;

export interface DrawingFacts {
  floors: number;
  basementFloors: number;
  grossArea: number;
  siteArea: number;
  excavationDepth: number;
}

export interface DrawingItem extends DrawingRule {
  required: boolean;
  reason?: string;
}

function evaluate(w: When, f: DrawingFacts): { ok: boolean; reason: string } {
  const checks: { ok: boolean; text: string }[] = [];
  if (w.floorsAtLeast != null) checks.push({ ok: f.floors >= w.floorsAtLeast, text: `층수 ${f.floors} ≥ ${w.floorsAtLeast}` });
  if (w.grossAreaAtLeast != null) checks.push({ ok: f.grossArea >= w.grossAreaAtLeast, text: `연면적 ${Math.round(f.grossArea)} ≥ ${w.grossAreaAtLeast}㎡` });
  if (w.siteAreaAtLeast != null) checks.push({ ok: f.siteArea >= w.siteAreaAtLeast, text: `대지 ${Math.round(f.siteArea)} ≥ ${w.siteAreaAtLeast}㎡` });
  if (w.basementFloorsAtLeast != null) checks.push({ ok: f.basementFloors >= w.basementFloorsAtLeast, text: `지하 ${f.basementFloors}층 ≥ ${w.basementFloorsAtLeast}` });
  if (w.excavationDepthAtLeast != null) checks.push({ ok: f.excavationDepth >= w.excavationDepthAtLeast, text: `굴착 ${f.excavationDepth.toFixed(1)}m ≥ ${w.excavationDepthAtLeast}m` });
  const ok = w.any ? checks.some((c) => c.ok) : checks.every((c) => c.ok);
  return { ok, reason: checks.map((c) => `${c.text}${c.ok ? " ✓" : " ✗"}`).join(", ") };
}

export function resolveDrawings(f: DrawingFacts): DrawingItem[] {
  const base = DATA.base.map((r) => ({ ...r, required: true }));
  const cond = DATA.conditional.map((r) => {
    const { ok, reason } = evaluate(r.when ?? {}, f);
    return { ...r, required: ok, reason };
  });
  return [...base, ...cond];
}
