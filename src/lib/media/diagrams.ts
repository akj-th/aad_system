// 자동 다이어그램 (M10). 상태값에서 결정론적으로 SVG를 만든다 — AI 없음.

import type { ExportedProject } from "@/store/project";
import { labelForUse } from "@/lib/massing/zoning";

const PALETTE = ["#2563eb", "#f59e0b", "#10b981", "#8b5cf6", "#ef4444", "#64748b", "#0ea5e9", "#a3a3a3"];
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const n = (v: number, d = 0) => v.toLocaleString("ko-KR", { maximumFractionDigits: d });

function frame(title: string, w: number, h: number, inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" font-family="sans-serif"><rect width="100%" height="100%" fill="#fff"/><text x="16" y="22" font-size="13" font-weight="600" fill="#18181b">${esc(title)}</text>${inner}</svg>`;
}

/** 용도별 연면적 스택 바 */
export function useStackSvg(p: ExportedProject): string {
  const { uses, grossArea } = p.program;
  const w = 520, h = 150;
  if (!uses.length || !grossArea) return frame("용도 구성", w, h, `<text x="16" y="70" font-size="11" fill="#94a3b8">용도 미설정</text>`);
  let x = 16;
  const bars = uses
    .map((u, i) => {
      const bw = (u.ratio / 100) * (w - 32);
      const s = `<rect x="${x}" y="44" width="${bw}" height="36" fill="${PALETTE[i % PALETTE.length]}"/>${bw > 50 ? `<text x="${x + bw / 2}" y="66" font-size="10" fill="#fff" text-anchor="middle">${u.ratio}%</text>` : ""}`;
      x += bw;
      return s;
    })
    .join("");
  const legend = uses
    .map((u, i) => `<g transform="translate(${16 + (i % 3) * 170}, ${104 + Math.floor(i / 3) * 16})"><rect width="10" height="10" fill="${PALETTE[i % PALETTE.length]}"/><text x="14" y="9" font-size="10" fill="#3f3f46">${esc(labelForUse(u.code))} ${n((grossArea * u.ratio) / 100)}㎡</text></g>`)
    .join("");
  return frame(`용도 구성 · 연면적 ${n(grossArea)}㎡`, w, h, bars + legend);
}

/** 매스 대안 비교 (층수·높이·바닥) */
export function massCompareSvg(p: ExportedProject): string {
  const sc = p.massing.scenarios;
  const w = 520, h = 220;
  if (!sc.length) return frame("매스 대안 비교", w, h, `<text x="16" y="70" font-size="11" fill="#94a3b8">대안 없음</text>`);
  const maxH = Math.max(...sc.map((s) => s.height ?? 0), 1);
  const colW = (w - 32) / sc.length;
  const items = sc
    .map((s, i) => {
      const bh = ((s.height ?? 0) / maxH) * 120;
      const bw = Math.max(20, Math.min(colW - 40, ((s.footprintArea ?? 0) / (sc[0].footprintArea ?? 1)) * (colW - 40)));
      const cx = 16 + colW * i + colW / 2;
      const active = s.id === p.meta.activeScenarioId;
      return `<rect x="${cx - bw / 2}" y="${170 - bh}" width="${bw}" height="${bh}" fill="${active ? "#7c3aed" : "#c4b5fd"}" stroke="#4c1d95"/>
<text x="${cx}" y="186" font-size="10" text-anchor="middle" fill="#18181b">${esc(s.name)}</text>
<text x="${cx}" y="200" font-size="9" text-anchor="middle" fill="#71717a">${s.floors}층 · ${n(s.height ?? 0)}m · 바닥 ${n(s.footprintArea ?? 0)}㎡</text>
<text x="${cx}" y="${164 - bh}" font-size="9" text-anchor="middle" fill="#4c1d95">${s.sunlightOk ? "일조 ✓" : "일조 검토"}</text>`;
    })
    .join("");
  return frame("매스 대안 비교 (높이 ∝ 막대, 바닥 ∝ 폭)", w, h, `<line x1="16" y1="170" x2="${w - 16}" y2="170" stroke="#a1a1aa"/>${items}`);
}

/** 사업비 구성 도넛 */
export function costDonutSvg(p: ExportedProject): string {
  const f = p.feasibility;
  const parts = [
    ["토지비", f.landCost],
    ["공사비", f.constructionCost],
    ["간접비", f.softCost],
    ["금융비", f.financeCost],
  ] as const;
  const total = parts.reduce((s, [, v]) => s + v, 0);
  const w = 520, h = 200;
  if (!total) return frame("사업비 구성", w, h, `<text x="16" y="70" font-size="11" fill="#94a3b8">미산정</text>`);
  const cx = 110, cy = 110, r = 64, ri = 38;
  let a0 = -Math.PI / 2;
  const arcs = parts
    .map(([, v], i) => {
      const a1 = a0 + (v / total) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const d = `M${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)} L${cx + ri * Math.cos(a1)},${cy + ri * Math.sin(a1)} A${ri},${ri} 0 ${large} 0 ${cx + ri * Math.cos(a0)},${cy + ri * Math.sin(a0)}Z`;
      a0 = a1;
      return `<path d="${d}" fill="${PALETTE[i]}"/>`;
    })
    .join("");
  const legend = parts
    .map(([k, v], i) => `<g transform="translate(220, ${60 + i * 26})"><rect width="12" height="12" fill="${PALETTE[i]}"/><text x="18" y="10" font-size="11" fill="#3f3f46">${k} ${n(v / 1e8, 1)}억 (${n((v / total) * 100, 1)}%)</text></g>`)
    .join("");
  return frame(`사업비 구성 · 총 ${n(total / 1e8, 1)}억원`, w, h, arcs + `<text x="${cx}" y="${cy + 4}" font-size="11" text-anchor="middle" fill="#18181b">총사업비</text>` + legend);
}
